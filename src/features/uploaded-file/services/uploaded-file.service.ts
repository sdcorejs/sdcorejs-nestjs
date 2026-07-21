import { BadRequestException, Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Readable } from 'node:stream';
import { In, IsNull, LessThan, Not, type DeepPartial, type FindOptionsWhere, type QueryDeepPartialEntity, type Repository } from 'typeorm';
import { ContextService } from '../../../core/context/context.service';
import type { RequestContext } from '../../../core/context/types';
import { apiError } from '../../../core/orm/types/api-response.types';
import type { NormalizedUploadedFileConfig } from '../config';
import { secureFetchRemote } from '../remote-fetcher';
import { UPLOADED_FILE_STORAGE_DRIVER, type UploadedFileStorageDriver } from '../storage-driver';
import {
  UPLOADED_FILE_CONFIG,
  UPLOADED_FILE_BATCH_LIMIT,
  UPLOADED_FILE_REFERENCE_MAX_LENGTH,
  type UploadedFileAccessDecision,
  type UploadedFileMeta,
  type UploadedFileOperation,
  type UploadedFileScope,
  type UploadedFileUploadOptions,
} from '../types';
import { UploadedFile } from '../uploaded-file.entity';
import { buildStorageKey, contentDisposition, sanitizeOriginalFileName, validateUploadBuffer } from '../upload-security';
import { toMb } from '../utils';

interface AuthorizedAccess {
  context: RequestContext;
  decision: Exclude<UploadedFileAccessDecision, 'deny'>;
  scope: UploadedFileScope;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// A newly-created row stays hidden while its object is written. Maintenance retries ignore the
// row until this deadline, preventing a cleanup worker from racing a healthy in-flight upload.
const UPLOAD_ACTIVATION_LEASE_MS = 15 * 60 * 1000;

// A deleter moves a retryable marker to a fresh future timestamp before touching storage. This
// makes the timestamp a compare-and-swap ownership token as well as a lease: another worker can
// retry an abandoned claim after the deadline, but cannot race the current storage operation.
const DELETION_CLAIM_LEASE_MS = 15 * 60 * 1000;

// Failed storage work is moved out of the immediately eligible window. Besides avoiding a hot
// retry loop, this lets the next bounded maintenance query advance past a full batch of poison
// rows. The operator-only tombstone retirement path deliberately uses a separate immediate marker.
const DELETION_RETRY_BACKOFF_MS = 60 * 1000;

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
}

/**
 * Tenant-aware uploaded-file application service.
 *
 * Every ordinary I/O method resolves a trusted tenant and owner from {@link ContextService}, then
 * applies the configured authorization policy. Owner access is the fail-safe default; a policy may
 * explicitly widen an operation to the resolved tenant. Invalid identifiers, missing rows, policy
 * denials, and cross-scope resources use the same non-enumerating not-found response. Upload
 * contents, names, metadata, identifiers, references, and batch sizes are validated before use.
 *
 * Upload activation uses a durable `uploadPendingAt` lease/tombstone, while object deletion uses a
 * separate `deletionPendingAt` claim before bytes are removed and the row is soft-deleted. Operators
 * must run {@link unsafeSystemRetryPendingDeletions} to drain failures. Methods prefixed with
 * `unsafeSystem` deliberately bypass request tenant/owner policy and belong only in trusted
 * maintenance jobs.
 */
@Injectable()
export class UploadedFileService {
  private readonly logger = new Logger(UploadedFileService.name);
  private lastDeletionClaimAt = 0;

  constructor(
    @InjectRepository(UploadedFile) private readonly repository: Repository<UploadedFile>,
    @Inject(UPLOADED_FILE_STORAGE_DRIVER) private readonly storage: UploadedFileStorageDriver,
    @Inject(UPLOADED_FILE_CONFIG) private readonly config: NormalizedUploadedFileConfig,
    @Optional() @Inject(ContextService) private readonly context?: ContextService,
  ) {}

  /**
   * Return allowlisted storage response metadata inferred from a file-name extension.
   *
   * This pure helper performs no lookup or authorization. Unknown extensions return an empty object
   * instead of guessing an active/text MIME type; recognized types include a sanitized attachment
   * disposition.
   */
  getContent(fileName?: string): { ContentType?: string; ContentDisposition?: string } {
    const ext = fileName?.toLowerCase().split('.').pop();
    const types: Readonly<Record<string, string>> = {
      csv: 'text/csv',
      gif: 'image/gif',
      jpeg: 'image/jpeg',
      jpg: 'image/jpeg',
      json: 'application/json',
      pdf: 'application/pdf',
      png: 'image/png',
      txt: 'text/plain',
      webp: 'image/webp',
      zip: 'application/zip',
    };
    const ContentType = ext ? types[ext] : undefined;
    return ContentType ? { ContentType, ContentDisposition: contentDisposition(fileName ?? 'file') } : {};
  }

  private notFound(): NotFoundException {
    return new NotFoundException(apiError('core.file.not-found', 'File not found'));
  }

  private badRequest(code: string, message: string): BadRequestException {
    return new BadRequestException(apiError(code, message));
  }

  private currentContext(): RequestContext {
    const context = this.context?.store;
    if (!context) throw this.notFound();
    return context;
  }

  private resolveScope(context: RequestContext): UploadedFileScope {
    const custom = context.custom ?? {};
    let configured: Partial<UploadedFileScope>;
    try {
      configured = this.config.resolveScope?.(context) ?? {};
    } catch {
      throw this.notFound();
    }
    const tenantCode = configured.tenantCode ?? (typeof custom.tenantCode === 'string' ? custom.tenantCode : context.tenant);
    const departmentCode = configured.departmentCode ?? (typeof custom.departmentCode === 'string' ? custom.departmentCode : undefined);
    const userId = configured.userId ?? context.userId;
    if (typeof tenantCode !== 'string' || typeof userId !== 'string') throw this.notFound();
    const normalizedTenant = tenantCode.trim();
    const normalizedDepartment = typeof departmentCode === 'string' ? departmentCode.trim() || undefined : undefined;
    const normalizedUser = userId.trim();
    if (
      !normalizedTenant ||
      normalizedTenant.length > 64 ||
      hasControlCharacter(normalizedTenant) ||
      !UUID_PATTERN.test(normalizedUser) ||
      (departmentCode !== undefined && typeof departmentCode !== 'string') ||
      (normalizedDepartment !== undefined && (normalizedDepartment.length > 64 || hasControlCharacter(normalizedDepartment)))
    ) {
      throw this.notFound();
    }
    return {
      tenantCode: normalizedTenant,
      departmentCode: normalizedDepartment,
      userId: normalizedUser,
    };
  }

  private resourceId(id: string): string {
    if (typeof id !== 'string' || !UUID_PATTERN.test(id)) throw this.notFound();
    return id;
  }

  private batchIds(ids: readonly string[]): string[] {
    if (
      !Array.isArray(ids) ||
      ids.length > UPLOADED_FILE_BATCH_LIMIT ||
      ids.some((id) => typeof id !== 'string' || !UUID_PATTERN.test(id))
    ) {
      throw this.notFound();
    }
    return Array.from(new Set(ids));
  }

  private batchReferences(references: readonly string[]): string[] {
    if (
      !Array.isArray(references) ||
      references.length > UPLOADED_FILE_BATCH_LIMIT ||
      references.some(
        (reference) =>
          typeof reference !== 'string' ||
          !reference ||
          reference !== reference.trim() ||
          reference.length > UPLOADED_FILE_REFERENCE_MAX_LENGTH ||
          hasControlCharacter(reference),
      )
    ) {
      throw this.notFound();
    }
    return Array.from(new Set(references));
  }

  private async authorize(
    operation: UploadedFileOperation,
    resourceIds: readonly string[] = [],
    storageReferences: readonly string[] = [],
  ): Promise<AuthorizedAccess> {
    const context = this.currentContext();
    const scope = this.resolveScope(context);
    let decision: UploadedFileAccessDecision = 'owner';
    if (this.config.authorizationPolicy) {
      try {
        decision = await this.config.authorizationPolicy({
          operation,
          context,
          scope,
          resourceIds: [...resourceIds],
          storageReferences: [...storageReferences],
        });
      } catch {
        decision = 'deny';
      }
    }
    if (decision !== 'owner' && decision !== 'tenant') throw this.notFound();
    return { context, decision, scope };
  }

  private where(access: AuthorizedAccess, extra: FindOptionsWhere<UploadedFile> = {}): FindOptionsWhere<UploadedFile> {
    return {
      ...extra,
      tenantCode: access.scope.tenantCode,
      ...(access.scope.departmentCode ? { departmentCode: access.scope.departmentCode } : {}),
      ...(access.decision === 'owner' ? { userId: access.scope.userId } : {}),
      deletedAt: IsNull(),
      uploadPendingAt: IsNull(),
      deletionPendingAt: IsNull(),
    };
  }

  private normalizeMeta(meta?: UploadedFileMeta): UploadedFileMeta {
    const result: UploadedFileMeta = {};
    for (const key of ['module', 'entity', 'type'] as const) {
      const raw = meta?.[key];
      if (raw !== undefined && typeof raw !== 'string') throw this.badRequest('core.file.invalid-meta', 'Invalid uploaded file metadata');
      const value = raw?.trim();
      if (value && value.length > 64) throw this.badRequest('core.file.invalid-meta', 'Invalid uploaded file metadata');
      if (value) result[key] = value;
    }
    const rawEntityId = meta?.entityId;
    if (rawEntityId !== undefined && typeof rawEntityId !== 'string') {
      throw this.badRequest('core.file.invalid-meta', 'Invalid uploaded file metadata');
    }
    const entityId = rawEntityId?.trim();
    if (entityId && !UUID_PATTERN.test(entityId)) throw this.badRequest('core.file.invalid-meta', 'Invalid uploaded file metadata');
    if (entityId) result.entityId = entityId;
    return result;
  }

  private privateDownloadUrl(id: string): string {
    const base = this.config.host ? `${this.config.host.replace(/\/+$/, '')}/` : '';
    return `${base}${this.config.downloadPath}/${id}/download`;
  }

  private pendingUploadWhere(saved: UploadedFile, access: AuthorizedAccess, expectedMarker: Date): FindOptionsWhere<UploadedFile> {
    return {
      id: saved.id,
      tenantCode: access.scope.tenantCode,
      departmentCode: access.scope.departmentCode ?? IsNull(),
      userId: access.scope.userId,
      deletedAt: IsNull(),
      uploadPendingAt: expectedMarker,
      deletionPendingAt: IsNull(),
    };
  }

  private async activatePendingUpload(saved: UploadedFile, access: AuthorizedAccess, expectedMarker: Date): Promise<void> {
    const result = await this.repository.update(this.pendingUploadWhere(saved, access, expectedMarker), { uploadPendingAt: null });
    if (result.affected !== 1) throw new Error('Uploaded-file activation failed');
    saved.uploadPendingAt = null;
  }

  private async confirmedActiveUpload(saved: UploadedFile, access: AuthorizedAccess): Promise<UploadedFile | null> {
    try {
      return await this.repository.findOne({
        where: {
          id: saved.id,
          tenantCode: access.scope.tenantCode,
          departmentCode: access.scope.departmentCode ?? IsNull(),
          userId: access.scope.userId,
          deletedAt: IsNull(),
          uploadPendingAt: IsNull(),
          deletionPendingAt: IsNull(),
        },
      });
    } catch {
      return null;
    }
  }

  private nextDeletionClaim(expectedMarker?: Date): Date {
    const timestamp = Math.max(
      Date.now() + DELETION_CLAIM_LEASE_MS,
      this.lastDeletionClaimAt + 1,
      expectedMarker ? expectedMarker.getTime() + 1 : 0,
    );
    this.lastDeletionClaimAt = timestamp;
    return new Date(timestamp);
  }

  private immediateRetryMarkerFor(claim: Date): Date {
    return new Date(Math.min(Date.now() - 1, claim.getTime() - 1));
  }

  private retryBackoffMarker(): Date {
    return new Date(Date.now() + DELETION_RETRY_BACKOFF_MS);
  }

  private pendingDeletionWhere(
    rows: readonly UploadedFile[],
    expectedMarker: Date,
    access?: AuthorizedAccess,
  ): FindOptionsWhere<UploadedFile> {
    const expectedDeletedAt = rows[0]?.deletedAt instanceof Date ? rows[0].deletedAt : IsNull();
    const expectedUploadPendingAt = rows[0]?.uploadPendingAt instanceof Date ? rows[0].uploadPendingAt : IsNull();
    return {
      id: In(rows.map(({ id }) => id)),
      ...(access
        ? {
            tenantCode: access.scope.tenantCode,
            ...(access.scope.departmentCode ? { departmentCode: access.scope.departmentCode } : {}),
            ...(access.decision === 'owner' ? { userId: access.scope.userId } : {}),
          }
        : {}),
      deletedAt: expectedDeletedAt,
      uploadPendingAt: expectedUploadPendingAt,
      deletionPendingAt: expectedMarker,
    };
  }

  private async releaseDeletionClaim(rows: readonly UploadedFile[], claim: Date, access?: AuthorizedAccess): Promise<void> {
    if (!rows.length) return;
    await this.repository.update(this.pendingDeletionWhere(rows, claim, access), {
      deletionPendingAt: this.retryBackoffMarker(),
    });
  }

  private async deleteWrittenObjectWhenActivationIsImpossible(
    saved: UploadedFile,
    access: AuthorizedAccess,
    activationMarker: Date,
  ): Promise<void> {
    // Claim durable retry state before touching storage. The bounded re-read loop handles a
    // maintenance worker moving the row between non-deleted and soft-deleted states after our read.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let current: UploadedFile | null;
      try {
        current = await this.repository.findOne({
          where: {
            id: saved.id,
            tenantCode: access.scope.tenantCode,
            departmentCode: access.scope.departmentCode ?? IsNull(),
            userId: access.scope.userId,
          },
          withDeleted: true,
        });
      } catch {
        return;
      }

      // Absence can be a stale/ambiguous read. A live row with neither pending field is active and
      // must never lose its bytes. Every other positively observed state can be atomically settled:
      // clearing uploadPendingAt proves a late activation CAS can no longer win.
      if (!current || (!current.deletedAt && current.uploadPendingAt === null && current.deletionPendingAt === null)) return;

      const currentUploadMarker = current.uploadPendingAt;
      const currentDeletionMarker = current.deletionPendingAt;
      const claim = this.nextDeletionClaim(currentDeletionMarker ?? activationMarker);
      let claimed = false;
      try {
        const result = await this.repository.update(
          {
            id: current.id,
            tenantCode: access.scope.tenantCode,
            departmentCode: access.scope.departmentCode ?? IsNull(),
            userId: access.scope.userId,
            deletedAt: current.deletedAt ?? IsNull(),
            uploadPendingAt: currentUploadMarker ?? IsNull(),
            deletionPendingAt: currentDeletionMarker ?? IsNull(),
          },
          {
            uploadPendingAt: null,
            deletionPendingAt: claim,
            ...(current.deletedAt ? { deletedAt: null } : {}),
          } as unknown as QueryDeepPartialEntity<UploadedFile>,
        );
        claimed = result.affected === 1;
      } catch {
        return;
      }
      if (!claimed) continue;

      current.deletedAt = null as unknown as Date;
      current.uploadPendingAt = null;
      current.deletionPendingAt = claim;
      await this.deleteAndFinalizePendingRows([current], claim, access).catch(() =>
        this.logger.error('Uploaded-file terminal object cleanup remains pending'),
      );
      return;
    }
  }

  private async cleanupFailedUpload(saved: UploadedFile, access: AuthorizedAccess, expectedMarker: Date): Promise<void> {
    // Move the exact activation marker to a fresh cleanup lease before deleting. A late activation
    // still expecting the original marker must then affect zero rows and cannot resurrect the row.
    let claimed = false;
    const claim = this.nextDeletionClaim(expectedMarker);
    try {
      const result = await this.repository.update(this.pendingUploadWhere(saved, access, expectedMarker), {
        uploadPendingAt: null,
        deletionPendingAt: claim,
      });
      claimed = result.affected === 1;
    } catch {
      this.logger.error('Uploaded-file failure could not be claimed for cleanup');
    }
    if (!claimed) {
      await this.deleteWrittenObjectWhenActivationIsImpossible(saved, access, expectedMarker);
      return;
    }
    saved.uploadPendingAt = null;
    saved.deletionPendingAt = claim;
    await this.deleteAndFinalizePendingRows([saved], claim, access).catch(() => this.logger.error('Uploaded-file cleanup remains pending'));
  }

  /**
   * Validate and persist a caller-provided buffer within the current authorized tenant/owner context.
   *
   * The service enforces the configured size/MIME/signature rules, sanitizes the original name and
   * metadata, and generates an immutable tenant-namespaced storage key. The database row is first
   * persisted with a hidden upload-activation lease, then the object is written, and finally the row
   * is activated. A failure therefore always leaves either no object or durable recovery state;
   * validation, persistence, storage, and activation details are never exposed to callers.
   */
  async upload<TExtraData = Record<string, unknown>>(
    buffer: Buffer,
    fileName?: string,
    meta?: UploadedFileMeta,
    extraData?: Partial<TExtraData>,
    options?: UploadedFileUploadOptions,
  ): Promise<UploadedFile<TExtraData>> {
    const access = await this.authorize('create');
    let validated: ReturnType<typeof validateUploadBuffer>;
    try {
      validated = validateUploadBuffer(
        buffer,
        fileName,
        options?.contentType,
        this.config.allowedMimeTypes,
        this.config.validateMagicBytes,
        this.config.maxFileSizeBytes,
      );
    } catch {
      throw this.badRequest('core.file.invalid-upload', 'Uploaded file failed validation');
    }
    const safeMeta = this.normalizeMeta(meta);
    const generated = buildStorageKey(this.config.folder, access.scope.tenantCode, validated.originalName);
    const cdn = this.config.publicFiles ? this.storage.publicUrl(generated.key) : this.privateDownloadUrl(generated.id);
    const activationMarker = new Date(Date.now() + UPLOAD_ACTIVATION_LEASE_MS);
    const row = this.repository.create({
      id: generated.id,
      fileName: validated.originalName,
      fileSize: toMb(buffer.byteLength),
      fileExtension: validated.originalName.split('.').pop()?.toLowerCase(),
      key: generated.key,
      cdn,
      tenantCode: access.scope.tenantCode,
      departmentCode: access.scope.departmentCode,
      userId: access.scope.userId,
      uploadPendingAt: activationMarker,
      deletionPendingAt: null,
      ...safeMeta,
      extraData,
    } as DeepPartial<UploadedFile>);
    let saved: UploadedFile;
    try {
      saved = await this.repository.save(row);
    } catch {
      throw this.badRequest('core.file.upload-failed', 'File upload failed');
    }
    try {
      await this.storage.write(generated.key, buffer, {
        contentType: validated.contentType,
        contentDisposition: contentDisposition(validated.originalName),
      });
    } catch {
      await this.cleanupFailedUpload(saved, access, activationMarker);
      throw this.badRequest('core.file.upload-failed', 'File upload failed');
    }
    try {
      await this.activatePendingUpload(saved, access, activationMarker);
      return saved as unknown as UploadedFile<TExtraData>;
    } catch {
      // The UPDATE may have committed even when its response was lost. Confirm exact active state
      // before cleanup so a successful object is neither deleted nor reported as a failed upload.
      const active = await this.confirmedActiveUpload(saved, access);
      if (active) return active as UploadedFile<TExtraData>;
      await this.cleanupFailedUpload(saved, access, activationMarker);
      throw this.badRequest('core.file.upload-failed', 'File upload failed');
    }
  }

  /**
   * Store a validated temporary upload as a tracked, unused database row.
   *
   * Temporary uploads require a positive cleanup retention setting so orphaned objects have a
   * lifecycle. Like regular uploads, the row is persisted in hidden pending state before the object
   * write and activated only after storage succeeds. Any failed write or activation retains durable
   * cleanup state. Requires authorized `create` access for the current tenant/owner scope.
   */
  async uploadTemporary(buffer: Buffer, fileName?: string, options?: UploadedFileUploadOptions): Promise<{ key: string; cdn: string }> {
    const access = await this.authorize('create');
    if (
      typeof this.config.cleanupAfterDays !== 'number' ||
      !Number.isFinite(this.config.cleanupAfterDays) ||
      this.config.cleanupAfterDays <= 0
    ) {
      throw this.badRequest('core.file.temporary-cleanup-required', 'Temporary uploads require configured cleanup');
    }
    let validated: ReturnType<typeof validateUploadBuffer>;
    try {
      validated = validateUploadBuffer(
        buffer,
        fileName,
        options?.contentType,
        this.config.allowedMimeTypes,
        this.config.validateMagicBytes,
        this.config.maxFileSizeBytes,
      );
    } catch {
      throw this.badRequest('core.file.invalid-upload', 'Uploaded file failed validation');
    }
    const generated = buildStorageKey(this.config.folder, access.scope.tenantCode, validated.originalName, 'temporary');
    const cdn = this.config.publicFiles ? this.storage.publicUrl(generated.key) : this.privateDownloadUrl(generated.id);
    const activationMarker = new Date(Date.now() + UPLOAD_ACTIVATION_LEASE_MS);
    const row = this.repository.create({
      id: generated.id,
      fileName: validated.originalName,
      fileSize: toMb(buffer.byteLength),
      fileExtension: validated.originalName.split('.').pop()?.toLowerCase(),
      key: generated.key,
      cdn,
      tenantCode: access.scope.tenantCode,
      departmentCode: access.scope.departmentCode,
      userId: access.scope.userId,
      type: 'temporary',
      isUsed: false,
      uploadPendingAt: activationMarker,
      deletionPendingAt: null,
    } as DeepPartial<UploadedFile>);
    let saved: UploadedFile;
    try {
      saved = await this.repository.save(row);
    } catch {
      throw this.badRequest('core.file.upload-failed', 'File upload failed');
    }
    try {
      await this.storage.write(generated.key, buffer, {
        contentType: validated.contentType,
        contentDisposition: contentDisposition(validated.originalName),
      });
    } catch {
      await this.cleanupFailedUpload(saved, access, activationMarker);
      throw this.badRequest('core.file.upload-failed', 'File upload failed');
    }
    try {
      await this.activatePendingUpload(saved, access, activationMarker);
    } catch {
      const active = await this.confirmedActiveUpload(saved, access);
      if (active) return { key: active.key, cdn: active.cdn };
      await this.cleanupFailedUpload(saved, access, activationMarker);
      throw this.badRequest('core.file.upload-failed', 'File upload failed');
    }
    return { key: saved.key, cdn: saved.cdn };
  }

  /**
   * Fetch a remote object through the hardened remote-clone transport and persist it as an upload.
   *
   * Remote cloning must be explicitly enabled. The fetcher applies its SSRF, redirect, DNS, size,
   * and content controls; the downloaded bytes then pass the same upload validation and generated
   * storage-key path as {@link upload}. Because persistence delegates to `upload`, both `clone` and
   * `create` policy decisions must authorize the current scope. Failures do not reveal remote or
   * scoped resource details.
   */
  async cloneFromUrl<TExtraData = Record<string, unknown>>(
    url: string,
    fileName?: string,
    meta?: UploadedFileMeta,
    extraData?: Partial<TExtraData>,
  ): Promise<UploadedFile<TExtraData>> {
    await this.authorize('clone');
    if (this.config.remoteClone.enabled !== true) {
      throw this.badRequest('core.file.remote-disabled', 'Remote file cloning is disabled');
    }
    let remote: Awaited<ReturnType<typeof secureFetchRemote>>;
    try {
      remote = await secureFetchRemote(url, this.config.remoteClone);
    } catch {
      throw this.badRequest('core.file.remote-fetch-failed', 'Remote file fetch failed');
    }
    let derivedName = fileName;
    if (!derivedName) {
      try {
        derivedName = decodeURIComponent(remote.finalUrl.pathname.split('/').pop() || 'REMOTE');
      } catch {
        derivedName = 'REMOTE';
      }
    }
    return this.upload(remote.buffer, sanitizeOriginalFileName(derivedName), meta, extraData, { contentType: remote.contentType });
  }

  private async findAuthorized(id: string, operation: UploadedFileOperation): Promise<UploadedFile> {
    const resourceId = this.resourceId(id);
    const access = await this.authorize(operation, [resourceId]);
    const row = await this.repository.findOne({ where: this.where(access, { id: resourceId }) });
    if (!row) throw this.notFound();
    return row;
  }

  /**
   * Open an authorized file as a storage stream.
   *
   * The UUID lookup is constrained by tenant/department and, for owner decisions, user ID. Invalid
   * IDs, denied or missing rows, and storage download failures all produce the same non-enumerating
   * not-found response. HTTP adapters remain responsible for applying response headers.
   */
  async download(id: string): Promise<{ stream: Readable; fileName: string }> {
    const row = await this.findAuthorized(id, 'read');
    try {
      return { stream: await this.storage.download(row.key), fileName: row.fileName };
    } catch {
      throw this.notFound();
    }
  }

  /**
   * Look up one active, non-pending file under the current `read` policy and tenant/owner scope.
   * Malformed, unauthorized, cross-scope, deleted, and unknown IDs are indistinguishable to callers.
   */
  async findById<TExtraData = Record<string, unknown>>(id: string): Promise<UploadedFile<TExtraData>> {
    return (await this.findAuthorized(id, 'read')) as UploadedFile<TExtraData>;
  }

  /**
   * Replace a file's consumer-defined `extraData` under the current scoped `update` policy.
   * The mutation includes the validated UUID and scope in one SQL update and requires exactly one
   * affected row; all misses and authorization failures use the non-enumerating response.
   */
  async setExtraData<TExtraData = Record<string, unknown>>(id: string, extraData: Partial<TExtraData>): Promise<void> {
    const resourceId = this.resourceId(id);
    const access = await this.authorize('update', [resourceId]);
    const result = await this.repository.update(this.where(access, { id: resourceId }), {
      extraData,
    } as unknown as QueryDeepPartialEntity<UploadedFile>);
    if (result.affected !== 1) throw this.notFound();
  }

  private async mutateIds(ids: readonly string[], meta?: UploadedFileMeta): Promise<void> {
    const unique = this.batchIds(ids);
    if (!unique.length) return;
    const access = await this.authorize('mark-used', unique);
    const safeMeta = this.normalizeMeta(meta);
    await this.repository.manager.transaction(async (manager) => {
      const repository = manager.getRepository(UploadedFile);
      const criteria = this.where(access, { id: In(unique) });
      const rows = await repository.find({ where: criteria, select: { id: true } });
      if (rows.length !== unique.length) throw this.notFound();
      const result = await repository.update(criteria, { isUsed: true, ...safeMeta });
      if (result.affected !== unique.length) throw this.notFound();
    });
  }

  /**
   * Mark a bounded batch of file UUIDs as used and optionally attach normalized metadata.
   * Duplicate IDs are collapsed. Every requested row must be authorized and present; row
   * verification and mutation run with all-or-nothing transaction semantics. An empty batch is a
   * no-op, while malformed or over-limit batches fail without enumerating individual resources.
   */
  async markUsed(ids: string[], meta?: UploadedFileMeta): Promise<void> {
    await this.mutateIds(ids, meta);
  }

  private async rowsForReferences(
    repository: Repository<UploadedFile>,
    access: AuthorizedAccess,
    references: readonly string[],
  ): Promise<UploadedFile[]> {
    const unique = Array.from(new Set(references.filter(Boolean)));
    if (!unique.length) return [];
    const rows = await repository.find({
      where: [this.where(access, { key: In(unique) }), this.where(access, { cdn: In(unique) })],
    });
    const matched = new Set<string>();
    for (const row of rows) {
      if (unique.includes(row.key)) matched.add(row.key);
      if (unique.includes(row.cdn)) matched.add(row.cdn);
    }
    if (matched.size !== unique.length) throw this.notFound();
    return rows;
  }

  /**
   * Mark a bounded batch of exact storage-key or CDN references as used.
   *
   * References must already be trimmed; they are length/control-character checked, deduplicated,
   * and capped before the policy runs. Every reference must resolve within the same authorized
   * tenant/owner scope; the transactional update is all-or-nothing and does not reveal which
   * reference failed.
   */
  async useFiles(references: string[], entity?: string, entityId?: string): Promise<void> {
    const unique = this.batchReferences(references);
    if (!unique.length) return;
    const access = await this.authorize('mark-used', [], unique);
    const safeMeta = this.normalizeMeta({ entity, entityId });
    await this.repository.manager.transaction(async (manager) => {
      const repository = manager.getRepository(UploadedFile);
      const rows = await this.rowsForReferences(repository, access, unique);
      const ids = rows.map(({ id }) => id);
      const criteria = this.where(access, { id: In(ids) });
      const result = await repository.update(criteria, { isUsed: true, ...safeMeta });
      if (result.affected !== ids.length) throw this.notFound();
    });
  }

  /**
   * Durably delete a bounded batch of exact storage-key or CDN references.
   *
   * All references must resolve under the current `delete` policy. A transaction first marks every
   * row as deletion-pending; only then are object bytes removed and rows soft-deleted. Storage or
   * finalization failure leaves the claim available to {@link unsafeSystemRetryPendingDeletions}
   * and returns a generic failure without exposing scoped resource existence.
   */
  async delete(references: string[]): Promise<void> {
    const unique = this.batchReferences(references);
    if (!unique.length) return;
    const access = await this.authorize('delete', [], unique);
    const claim = this.nextDeletionClaim();
    const rows = await this.repository.manager.transaction(async (manager) => {
      const repository = manager.getRepository(UploadedFile);
      const authorized = await this.rowsForReferences(repository, access, unique);
      const ids = authorized.map(({ id }) => id);
      const result = await repository.update(this.where(access, { id: In(ids) }), { deletionPendingAt: claim });
      if (result.affected !== ids.length) throw this.notFound();
      for (const row of authorized) row.deletionPendingAt = claim;
      return authorized;
    });
    try {
      await this.deleteAndFinalizePendingRows(rows, claim, access);
    } catch {
      this.logger.error('Uploaded-file deletion remains pending for retry');
      throw this.badRequest('core.file.delete-failed', 'File deletion failed');
    }
  }

  /**
   * Reconcile old and new bounded reference sets by marking all new files used, then durably
   * deleting references no longer present.
   *
   * Each phase applies its own scope/policy and non-enumerating batch validation. The two phases are
   * intentionally sequential rather than one cross-storage transaction: if deletion fails after a
   * successful mark-used phase, pending deletion state is retained for maintenance retry.
   */
  async changeFiles(olds: string[], news: string[], entity?: string, entityId?: string): Promise<void> {
    const oldReferences = this.batchReferences(olds);
    const newReferences = this.batchReferences(news);
    await this.useFiles(newReferences, entity, entityId);
    const removed = oldReferences.filter((value) => !newReferences.includes(value));
    await this.delete(removed);
  }

  private async finalizePendingRows(rows: readonly UploadedFile[], claim: Date, access?: AuthorizedAccess): Promise<number> {
    if (!rows.length) return 0;
    const result = await this.repository.softDelete(this.pendingDeletionWhere(rows, claim, access));
    return result.affected ?? 0;
  }

  private async clearFinalizedDeletionClaim(rows: readonly UploadedFile[], claim: Date, access?: AuthorizedAccess): Promise<void> {
    // An unresolved upload tombstone must retain its deletion claim across process death. Only the
    // writer's settled cleanup path clears uploadPendingAt, after which finalization may clear this.
    if (rows.some(({ uploadPendingAt }) => uploadPendingAt instanceof Date)) return;
    const result = await this.repository.update(
      {
        id: In(rows.map(({ id }) => id)),
        ...(access
          ? {
              tenantCode: access.scope.tenantCode,
              ...(access.scope.departmentCode ? { departmentCode: access.scope.departmentCode } : {}),
              ...(access.decision === 'owner' ? { userId: access.scope.userId } : {}),
            }
          : {}),
        deletedAt: Not(IsNull()),
        uploadPendingAt: IsNull(),
        deletionPendingAt: claim,
      },
      { deletionPendingAt: null },
    );
    if (result.affected !== rows.length) throw new Error('Uploaded-file finalized claim could not be cleared');
  }

  private async deleteAndFinalizePendingRows(rows: readonly UploadedFile[], claim: Date, access?: AuthorizedAccess): Promise<number> {
    if (!rows.length) return 0;
    try {
      await this.storage.delete(rows.map(({ key }) => key));
      const finalized = await this.finalizePendingRows(rows, claim, access);
      if (finalized !== rows.length) throw new Error('Uploaded-file deletion finalization lost its claim');
      // Clearing is a separate best-effort CAS. If it fails, the soft-deleted row retains the
      // future claim and the withDeleted maintenance scan safely retries it after lease expiry.
      await this.clearFinalizedDeletionClaim(rows, claim, access).catch(() =>
        this.logger.error('Uploaded-file finalized deletion claim remains pending'),
      );
      return finalized;
    } catch (error) {
      await this.releaseDeletionClaim(rows, claim, access).catch(() =>
        this.logger.error('Uploaded-file deletion claim could not be released for retry'),
      );
      throw error;
    }
  }

  private systemDeletionLimit(limit: number): number {
    if (!Number.isFinite(limit)) return UPLOADED_FILE_BATCH_LIMIT;
    return Math.max(1, Math.min(Math.floor(limit), UPLOADED_FILE_BATCH_LIMIT));
  }

  /**
   * Retry a bounded set of durable storage-deletion claims across all tenants.
   *
   * @internal
   * Unsafe boundary: this method intentionally performs no request-context or authorization-policy
   * check. Invoke it only from a trusted maintenance worker. The limit is clamped to the library
   * batch cap. Settled deletion claims are prioritized; remaining capacity processes expired upload
   * tombstones. Future leases cannot be raced. Successfully deleted rows are finalized, unresolved
   * uploads retain a scheduled tombstone across process death, and failed rows receive a future
   * retry backoff so the next bounded query can advance. The returned count includes only rows
   * finalized by this run.
   */
  async unsafeSystemRetryPendingDeletions(limit = UPLOADED_FILE_BATCH_LIMIT): Promise<number> {
    const now = new Date();
    const batchLimit = this.systemDeletionLimit(limit);
    // Prioritize settled deletion work so abandoned uploader tombstones cannot starve newer user
    // deletions. Any remaining batch capacity is used for unresolved upload recovery.
    const settled = await this.repository.find({
      where: { uploadPendingAt: IsNull(), deletionPendingAt: LessThan(now) },
      order: { deletionPendingAt: 'ASC' },
      take: batchLimit,
      withDeleted: true,
    });
    const remaining = batchLimit - settled.length;
    const [initialTombstones, retryTombstones] = remaining
      ? await Promise.all([
          this.repository.find({
            where: { uploadPendingAt: LessThan(now), deletionPendingAt: IsNull() },
            order: { uploadPendingAt: 'ASC' },
            take: remaining,
            withDeleted: true,
          }),
          this.repository.find({
            where: { uploadPendingAt: LessThan(now), deletionPendingAt: LessThan(now) },
            order: { deletionPendingAt: 'ASC' },
            take: remaining,
            withDeleted: true,
          }),
        ])
      : [[], []];
    const initialQuota = Math.ceil(remaining / 2);
    const retryQuota = remaining - initialQuota;
    const unresolved = [...initialTombstones.slice(0, initialQuota), ...retryTombstones.slice(0, retryQuota)];
    unresolved.push(
      ...[...initialTombstones.slice(initialQuota), ...retryTombstones.slice(retryQuota)].slice(0, remaining - unresolved.length),
    );
    const rows = [...settled, ...unresolved];
    let finalized = 0;
    for (const row of rows) {
      const selectedMarker =
        row.deletionPendingAt instanceof Date && row.deletionPendingAt < now
          ? row.deletionPendingAt
          : row.uploadPendingAt instanceof Date && row.uploadPendingAt < now && row.deletionPendingAt === null
            ? row.uploadPendingAt
            : null;
      if (!(selectedMarker instanceof Date)) continue;
      const claim = this.nextDeletionClaim(selectedMarker);
      try {
        const result = await this.repository.update(
          {
            id: row.id,
            deletedAt: row.deletedAt instanceof Date ? row.deletedAt : IsNull(),
            uploadPendingAt: row.uploadPendingAt ?? IsNull(),
            deletionPendingAt: row.deletionPendingAt instanceof Date ? row.deletionPendingAt : IsNull(),
          },
          {
            deletionPendingAt: claim,
            ...(row.deletedAt instanceof Date ? { deletedAt: null } : {}),
          } as unknown as QueryDeepPartialEntity<UploadedFile>,
        );
        if (result.affected !== 1) continue;
        row.deletedAt = null as unknown as Date;
        row.deletionPendingAt = claim;
        finalized += await this.deleteAndFinalizePendingRows([row], claim);
      } catch {
        this.logger.error('Uploaded-file pending deletion retry failed');
      }
    }
    return finalized;
  }

  /**
   * Retire one expired, abandoned upload tombstone into ordinary deletion-retry state.
   *
   * @internal
   * Unsafe boundary: call only after operators have stopped/drained the producing process and
   * verified that no storage write for this UUID can still complete. A live deletion lease is never
   * stolen; callers retry after it expires. The method performs no request authorization.
   */
  async unsafeSystemRetireUploadTombstone(id: string): Promise<boolean> {
    const resourceId = this.resourceId(id);
    const row = await this.repository.findOne({
      where: { id: resourceId, uploadPendingAt: Not(IsNull()) },
      withDeleted: true,
    });
    if (!row || !(row.uploadPendingAt instanceof Date)) return false;
    const now = new Date();
    if (row.uploadPendingAt >= now || (row.deletionPendingAt instanceof Date && row.deletionPendingAt >= now)) return false;

    const retryAt = this.immediateRetryMarkerFor(row.deletionPendingAt ?? row.uploadPendingAt);
    const result = await this.repository.update(
      {
        id: row.id,
        deletedAt: row.deletedAt instanceof Date ? row.deletedAt : IsNull(),
        uploadPendingAt: row.uploadPendingAt,
        deletionPendingAt: row.deletionPendingAt instanceof Date ? row.deletionPendingAt : IsNull(),
      },
      {
        uploadPendingAt: null,
        deletionPendingAt: retryAt,
        ...(row.deletedAt instanceof Date ? { deletedAt: null } : {}),
      } as unknown as QueryDeepPartialEntity<UploadedFile>,
    );
    return result.affected === 1;
  }

  /**
   * Claim and purge one bounded batch of unused files older than `cutoff` across all tenants.
   *
   * @internal
   * Unsafe boundary: this method intentionally bypasses request-context and authorization policy
   * and must be restricted to a trusted maintenance worker. Candidates are transactionally moved
   * into durable deletion-pending state before object deletion. A deletion failure preserves that
   * state for {@link unsafeSystemRetryPendingDeletions}; after storage deletion and the finalization
   * call complete, the return value is the number of candidates claimed by this run.
   */
  async unsafeSystemPurgeUnusedBefore(cutoff: Date): Promise<number> {
    const claim = this.nextDeletionClaim();
    const rows = await this.repository.manager.transaction(async (manager) => {
      const repository = manager.getRepository(UploadedFile);
      const criteria: FindOptionsWhere<UploadedFile> = {
        deletedAt: IsNull(),
        uploadPendingAt: IsNull(),
        deletionPendingAt: IsNull(),
        isUsed: false,
        createdAt: LessThan(cutoff),
      };
      const candidates = await repository.find({
        where: criteria,
        order: { createdAt: 'ASC' },
        take: UPLOADED_FILE_BATCH_LIMIT,
      });
      if (!candidates.length) return [];
      const ids = candidates.map(({ id }) => id);
      const result = await repository.update({ ...criteria, id: In(ids) }, { deletionPendingAt: claim });
      if (result.affected !== ids.length) throw new Error('Uploaded-file cleanup claim failed');
      for (const row of candidates) row.deletionPendingAt = claim;
      return candidates;
    });
    if (!rows.length) return 0;
    try {
      await this.deleteAndFinalizePendingRows(rows, claim);
    } catch {
      this.logger.error('Uploaded-file cleanup deletion remains pending for retry');
      throw this.badRequest('core.file.cleanup-failed', 'File cleanup failed');
    }
    return rows.length;
  }
}
