import { BadRequestException, GoneException, Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Readable } from 'node:stream';
import { DateUtilities } from '@sdcorejs/utils/fns';
import {
  In,
  IsNull,
  LessThan,
  LessThanOrEqual,
  Not,
  type DeepPartial,
  type EntityManager,
  type FindOptionsWhere,
  type QueryDeepPartialEntity,
  type Repository,
} from 'typeorm';
import { ContextService } from '../../../core/context/context.service';
import type { RequestContext } from '../../../core/context/types';
import { apiError } from '../../../core/orm/types/api-response.types';
import type { NormalizedUploadedFileConfig } from '../config';
import { secureFetchRemote } from '../remote-fetcher';
import { UPLOADED_FILE_STORAGE_DRIVER, type UploadedFileStorageDriver, type UploadedFileStorageSource } from '../storage-driver';
import {
  UPLOADED_FILE_CONFIG,
  UPLOADED_FILE_BATCH_LIMIT,
  UPLOADED_FILE_REFERENCE_MAX_LENGTH,
  type UploadedFileAccessDecision,
  type UploadedFileAttachment,
  type UploadedFileContext,
  type UploadedFileDisposition,
  type UploadedFileMeta,
  type UploadedFileOperation,
  type UploadedFileResult,
  type UploadedFileScope,
  type UploadedFileTemporaryUploadOptions,
  type UploadedFileUploadOptions,
  type UploadedFileVisibility,
  type InitiateUploadedFileInput,
  type InitiateUploadedFileResult,
} from '../types';
import { UploadedFile } from '../uploaded-file.entity';
import {
  buildStorageKey,
  buildStorageKeyForId,
  contentDisposition,
  sanitizeOriginalFileName,
  validateUploadBuffer,
  validateUploadMetadata,
} from '../upload-security';
import { toMb } from '../utils';

interface AuthorizedAccess {
  context: RequestContext;
  decision: Exclude<UploadedFileAccessDecision, 'deny'>;
  scope: UploadedFileScope;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
const TEMPORARY_FILE_LIFETIME_MS = 24 * 60 * 60 * 1000;

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
  private readonly completionPromises = new Map<string, Promise<UploadedFileResult>>();
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
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      txt: 'text/plain',
      webp: 'image/webp',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
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

  private gone(code: string, message: string): GoneException {
    return new GoneException(apiError(code, message));
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
    if (entityId && !UUID_PATTERN.test(entityId)) {
      throw this.badRequest('core.file.invalid-meta', 'Invalid uploaded file metadata');
    }
    if (entityId) result.entityId = entityId;
    return result;
  }

  private normalizeAttachment(attachment: UploadedFileAttachment): UploadedFileAttachment {
    if (!attachment || typeof attachment !== 'object') throw this.notFound();
    const module = typeof attachment.module === 'string' ? attachment.module.trim() : '';
    const entity = typeof attachment.entity === 'string' ? attachment.entity.trim() : '';
    const entityId = typeof attachment.entityId === 'string' ? attachment.entityId.trim() : '';
    if (
      !module ||
      !entity ||
      module.length > 64 ||
      entity.length > 64 ||
      hasControlCharacter(module) ||
      hasControlCharacter(entity) ||
      !UUID_PATTERN.test(entityId)
    ) {
      throw this.notFound();
    }
    return { module, entity, entityId };
  }

  private uploadValidationLimits(options?: UploadedFileUploadOptions): {
    allowedMimeTypes: readonly string[];
    maxFileSizeBytes: number;
  } {
    let allowedMimeTypes = this.config.allowedMimeTypes;
    if (options?.allowedMimeTypes !== undefined) {
      if (!Array.isArray(options.allowedMimeTypes)) throw new Error('Invalid per-call MIME allowlist');
      const requested = new Set(
        options.allowedMimeTypes
          .filter((mime): mime is string => typeof mime === 'string')
          .map((mime) => mime.trim().toLowerCase())
          .filter(Boolean),
      );
      allowedMimeTypes = this.config.allowedMimeTypes.filter((mime) => requested.has(mime));
      if (!allowedMimeTypes.length) throw new Error('Per-call MIME allowlist does not intersect module configuration');
    }

    let maxFileSizeBytes = this.config.maxFileSizeBytes;
    if (options?.maxFileSizeBytes !== undefined) {
      if (typeof options.maxFileSizeBytes !== 'number' || !Number.isFinite(options.maxFileSizeBytes) || options.maxFileSizeBytes <= 0) {
        throw new Error('Invalid per-call upload size');
      }
      maxFileSizeBytes = Math.min(this.config.maxFileSizeBytes, Math.floor(options.maxFileSizeBytes));
    }
    return { allowedMimeTypes, maxFileSizeBytes };
  }

  private privateDownloadUrl(id: string): string {
    const base = this.config.host ? `${this.config.host.replace(/\/+$/, '')}/` : '';
    return `${base}${this.config.downloadPath}/${id}/download`;
  }

  private localUploadUrl(id: string): string {
    const base = this.config.host ? `${this.config.host.replace(/\/+$/, '')}/` : '';
    return `${base}${this.config.downloadPath}/${id}/content`;
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

  private async activateTemporaryPendingUpload(saved: UploadedFile, access: AuthorizedAccess, expectedMarker: Date): Promise<void> {
    const completedAt = new Date();
    const expiredAt = DateUtilities.addMilliseconds(completedAt, TEMPORARY_FILE_LIFETIME_MS);
    if (!(expiredAt instanceof Date)) throw new Error('Uploaded-file temporary expiry failed');
    const result = await this.repository.update(this.pendingUploadWhere(saved, access, expectedMarker), {
      status: 'ready',
      isTemporary: true,
      uploadPendingAt: null,
      completedAt,
      expiredAt,
    });
    if (result.affected !== 1) throw new Error('Uploaded-file activation failed');
    saved.status = 'ready';
    saved.isTemporary = true;
    saved.uploadPendingAt = null;
    saved.completedAt = completedAt;
    saved.expiredAt = expiredAt;
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

  private verifyRequestedOwner(ownerId: string | undefined, access: AuthorizedAccess): void {
    if (ownerId !== undefined && ownerId !== access.scope.userId) throw this.notFound();
  }

  private lifecycleWhere(access: AuthorizedAccess, id: string): FindOptionsWhere<UploadedFile> {
    return {
      id,
      tenantCode: access.scope.tenantCode,
      ...(access.scope.departmentCode ? { departmentCode: access.scope.departmentCode } : {}),
      ...(access.decision === 'owner' ? { userId: access.scope.userId } : {}),
      deletedAt: IsNull(),
      deletionPendingAt: IsNull(),
    };
  }

  private async findLifecycleAuthorized(
    id: string,
    operation: Extract<UploadedFileOperation, 'complete' | 'abort' | 'read' | 'delete'>,
  ): Promise<{ access: AuthorizedAccess; row: UploadedFile }> {
    const resourceId = this.resourceId(id);
    const access = await this.authorize(operation, [resourceId]);
    const row = await this.repository.findOne({ where: this.lifecycleWhere(access, resourceId) });
    if (!row) throw this.notFound();
    return { access, row };
  }

  private directVisibility(requested: UploadedFileVisibility | undefined, temporary: boolean): UploadedFileVisibility {
    if (temporary) return 'private';
    const visibility = requested ?? 'private';
    if (visibility !== 'private' && visibility !== 'public') {
      throw this.badRequest('core.file.invalid-visibility', 'Invalid file visibility');
    }
    if (visibility === 'public' && this.config.allowPublicUploads !== true) {
      throw this.badRequest('core.file.public-upload-disabled', 'Public file uploads are disabled');
    }
    return visibility;
  }

  private directDisposition(requested: UploadedFileDisposition | undefined): UploadedFileDisposition {
    if (requested !== undefined && requested !== 'inline' && requested !== 'attachment') {
      throw this.badRequest('core.file.invalid-disposition', 'Invalid file disposition');
    }
    return requested ?? 'attachment';
  }

  private normalizedChecksum(checksum: string | undefined): string | null {
    if (checksum === undefined) return null;
    if (typeof checksum !== 'string') throw this.badRequest('core.file.invalid-checksum', 'Invalid upload checksum');
    const value = checksum.trim();
    if (!value || value.length > 128 || hasControlCharacter(value)) {
      throw this.badRequest('core.file.invalid-checksum', 'Invalid upload checksum');
    }
    return value;
  }

  private async initiateManagedUpload(
    input: InitiateUploadedFileInput,
    options: {
      access?: AuthorizedAccess;
      context?: UploadedFileContext;
      ownerId?: string;
      visibility?: UploadedFileVisibility;
      disposition?: UploadedFileDisposition;
      temporary: boolean;
      limits?: UploadedFileUploadOptions;
    },
  ): Promise<InitiateUploadedFileResult> {
    const access = options.access ?? (await this.authorize('create'));
    this.verifyRequestedOwner(options.ownerId, access);
    const limits = this.uploadValidationLimits(options.limits);
    let validated: ReturnType<typeof validateUploadMetadata>;
    try {
      validated = validateUploadMetadata(
        input.originalName,
        input.contentType,
        input.size,
        limits.allowedMimeTypes,
        limits.maxFileSizeBytes,
      );
    } catch {
      throw this.badRequest('core.file.invalid-upload', 'Uploaded file failed validation');
    }
    const visibility = this.directVisibility(options.visibility, options.temporary);
    const disposition = this.directDisposition(options.disposition);
    const safeMeta = this.normalizeMeta(options.context);
    const checksum = this.normalizedChecksum(input.checksum);
    const namespace = options.temporary ? 'temporary' : visibility;
    const generated = buildStorageKey(this.config.folder, access.scope.tenantCode, validated.originalName, namespace);
    const pending = buildStorageKeyForId(this.config.folder, access.scope.tenantCode, generated.id, validated.originalName, 'pending');
    const now = new Date();
    const uploadExpiredAt = new Date(now.getTime() + this.config.uploadUrlTtlSeconds * 1000);
    const uploadCleanupAt = new Date(uploadExpiredAt.getTime() + UPLOAD_ACTIVATION_LEASE_MS);
    const cdn = visibility === 'public' ? this.storage.resolvePublicUrl(generated.key) : this.privateDownloadUrl(generated.id);
    const row = this.repository.create({
      id: generated.id,
      fileName: validated.originalName,
      fileSize: toMb(validated.size),
      sizeBytes: validated.size,
      contentType: validated.contentType,
      fileExtension: validated.originalName.split('.').pop()?.toLowerCase(),
      key: generated.key,
      pendingKey: pending.key,
      cdn,
      tenantCode: access.scope.tenantCode,
      departmentCode: access.scope.departmentCode,
      userId: access.scope.userId,
      isUsed: false,
      visibility,
      status: 'pending',
      isTemporary: options.temporary,
      uploadExpiredAt,
      expiredAt: null,
      completedAt: null,
      disposition,
      checksum,
      etag: null,
      uploadPendingAt: uploadCleanupAt,
      deletionPendingAt: null,
      ...(options.temporary && safeMeta.type === undefined ? { type: 'temporary' } : {}),
      ...safeMeta,
    } as DeepPartial<UploadedFile>);
    let saved: UploadedFile;
    try {
      saved = await this.repository.save(row);
    } catch {
      throw this.badRequest('core.file.upload-failed', 'File upload failed');
    }

    try {
      const target = await this.storage.createUploadUrl({
        key: pending.key,
        contentType: validated.contentType,
        size: validated.size,
        expiresInSeconds: this.config.uploadUrlTtlSeconds,
        metadata: {
          'upload-id': generated.id,
          ...(checksum ? { checksum } : {}),
        },
        checksum,
        ...(this.storage.kind === 'local' ? { uploadUrl: this.localUploadUrl(generated.id) } : {}),
      });
      return {
        id: generated.id,
        status: 'pending',
        upload: {
          method: target.method,
          url: target.url,
          headers: { ...target.headers },
          expiredAt: uploadExpiredAt,
        },
      };
    } catch {
      await this.cleanupFailedUpload(saved, access, uploadCleanupAt);
      throw this.badRequest('core.file.upload-failed', 'File upload failed');
    }
  }

  /** Create a provider-neutral, private direct-upload instruction set for a browser/client. */
  async initiateUpload(input: InitiateUploadedFileInput): Promise<InitiateUploadedFileResult> {
    return this.initiateManagedUpload(input, { temporary: false, visibility: 'private' });
  }

  /** Compatibility-friendly canonical alias for {@link initiateUpload}. */
  async initiate(input: InitiateUploadedFileInput): Promise<InitiateUploadedFileResult> {
    return this.initiateUpload(input);
  }

  /** Create a private direct-upload instruction set whose completed object lives exactly 24 hours. */
  async initiateTemporaryUpload(input: InitiateUploadedFileInput): Promise<InitiateUploadedFileResult> {
    return this.initiateManagedUpload(input, { temporary: true, visibility: 'private' });
  }

  /** Compatibility-friendly canonical alias for {@link initiateTemporaryUpload}. */
  async initiateTemporary(input: InitiateUploadedFileInput): Promise<InitiateUploadedFileResult> {
    return this.initiateTemporaryUpload(input);
  }

  private assertReadyAndUnexpired(row: UploadedFile, now = new Date()): void {
    const status = row.status ?? 'ready';
    if (status !== 'ready') throw this.notFound();
    if (row.isTemporary === true && row.expiredAt instanceof Date && now.getTime() >= row.expiredAt.getTime()) {
      throw this.gone('core.file.expired', 'Temporary file has expired');
    }
  }

  private resolvedContentType(row: UploadedFile): string {
    return row.contentType ?? this.getContent(row.fileName).ContentType ?? 'application/octet-stream';
  }

  private async resolveRowUrl(row: UploadedFile, now = new Date()): Promise<{ url: string; urlExpiredAt: Date | null }> {
    this.assertReadyAndUnexpired(row, now);
    const visibility = row.visibility ?? (this.config.publicFiles ? 'public' : 'private');
    if (visibility === 'public') return { url: this.storage.resolvePublicUrl(row.key), urlExpiredAt: null };
    if (this.storage.kind === 'local') return { url: this.privateDownloadUrl(row.id), urlExpiredAt: null };

    let expiresInSeconds = Math.min(this.config.privateDownloadUrlTtlSeconds, this.config.maxPrivateDownloadUrlTtlSeconds, 60 * 60);
    let urlExpiredAt = new Date(now.getTime() + expiresInSeconds * 1000);
    if (row.isTemporary === true && row.expiredAt instanceof Date) {
      const remainingMs = row.expiredAt.getTime() - now.getTime();
      if (remainingMs <= 0) throw this.gone('core.file.expired', 'Temporary file has expired');
      const remainingWholeSeconds = Math.floor(remainingMs / 1000);
      if (remainingWholeSeconds < 1) {
        // S3 signatures use whole seconds. During the final sub-second, use the protected backend
        // route so access remains available before expiry without minting a URL valid past it.
        return { url: this.privateDownloadUrl(row.id), urlExpiredAt: row.expiredAt };
      }
      expiresInSeconds = Math.min(expiresInSeconds, remainingWholeSeconds);
      urlExpiredAt = new Date(now.getTime() + expiresInSeconds * 1000);
    }
    try {
      const url = await this.storage.createDownloadUrl({
        key: row.key,
        expiresInSeconds,
        contentType: this.resolvedContentType(row),
        contentDisposition: contentDisposition(row.fileName, row.disposition ?? 'attachment'),
        downloadUrl: this.privateDownloadUrl(row.id),
      });
      return { url, urlExpiredAt };
    } catch {
      throw this.notFound();
    }
  }

  private uploadedFileResult(row: UploadedFile, resolved: { url: string | null; urlExpiredAt: Date | null }): UploadedFileResult {
    return {
      id: row.id,
      fileName: row.fileName,
      originalName: row.fileName,
      fileSize: row.fileSize ?? toMb(row.sizeBytes ?? 0),
      size: row.sizeBytes ?? Math.max(0, Math.round((row.fileSize ?? 0) * 1024 * 1024)),
      key: row.key,
      cdn: row.cdn,
      contentType: this.resolvedContentType(row),
      visibility: row.visibility ?? (this.config.publicFiles ? 'public' : 'private'),
      status: row.status ?? 'ready',
      isTemporary: row.isTemporary === true,
      completedAt: row.completedAt ?? null,
      expiredAt: row.expiredAt ?? null,
      disposition: row.disposition ?? 'attachment',
      ...resolved,
    };
  }

  private async toUploadedFileResult(row: UploadedFile): Promise<UploadedFileResult> {
    return this.uploadedFileResult(row, await this.resolveRowUrl(row));
  }

  private metadataMatches(row: UploadedFile, metadata: Awaited<ReturnType<UploadedFileStorageDriver['headObject']>>): boolean {
    if (!metadata || metadata.size !== row.sizeBytes) return false;
    if (this.storage.kind === 's3' && !metadata.etag) return false;
    const actualContentType = metadata.contentType?.split(';', 1)[0]?.trim().toLowerCase();
    if (this.storage.kind === 's3' && actualContentType !== row.contentType?.toLowerCase()) return false;
    if (this.storage.kind === 'local' && actualContentType && actualContentType !== row.contentType?.toLowerCase()) return false;
    if (this.storage.kind === 's3' && metadata.metadata['upload-id'] !== row.id) return false;
    if (row.checksum && row.checksum !== metadata.checksum && row.checksum !== metadata.metadata.checksum) return false;
    return true;
  }

  private async markCompletionRetryable(row: UploadedFile, access: AuthorizedAccess, completionMarker: Date): Promise<void> {
    await this.repository
      .update(
        { ...this.lifecycleWhere(access, row.id), status: 'completing', uploadPendingAt: completionMarker },
        { uploadPendingAt: new Date(Date.now() - 1) },
      )
      .catch(() => undefined);
  }

  private completionIsActive(row: UploadedFile): boolean {
    return row.status === 'completing' && row.uploadPendingAt instanceof Date && row.uploadPendingAt.getTime() > Date.now();
  }

  private async completeManagedUpload(row: UploadedFile, access: AuthorizedAccess): Promise<UploadedFileResult> {
    if ((row.status ?? 'ready') === 'ready') return this.toUploadedFileResult(row);
    if (row.status !== 'pending' && row.status !== 'completing') {
      throw this.badRequest('core.file.upload-not-pending', 'File upload is not pending');
    }
    const now = new Date();
    if (
      !row.pendingKey ||
      !(row.uploadExpiredAt instanceof Date) ||
      (row.status === 'pending' && now.getTime() >= row.uploadExpiredAt.getTime())
    ) {
      throw this.badRequest('core.file.upload-expired', 'File upload has expired');
    }
    const pendingKey = row.pendingKey;

    let staging: Awaited<ReturnType<UploadedFileStorageDriver['headObject']>>;
    try {
      staging = await this.storage.headObject(row.pendingKey);
    } catch {
      throw this.badRequest('core.file.upload-verification-failed', 'Uploaded object could not be verified');
    }
    if (!this.metadataMatches(row, staging)) {
      throw this.badRequest('core.file.upload-verification-failed', 'Uploaded object failed verification');
    }

    const completionMarker = new Date(now.getTime() + UPLOAD_ACTIVATION_LEASE_MS);
    if (row.status === 'pending') {
      const claimed = await this.repository.update(
        { ...this.lifecycleWhere(access, row.id), status: 'pending', uploadPendingAt: row.uploadPendingAt ?? IsNull() },
        { status: 'completing', uploadPendingAt: completionMarker, etag: staging!.etag },
      );
      if (claimed.affected !== 1) {
        const current = await this.repository.findOne({ where: this.lifecycleWhere(access, row.id) });
        if (!current) throw this.notFound();
        if (current.status === 'ready') return this.toUploadedFileResult(current);
        if (current.status === 'completing') {
          throw this.badRequest('core.file.upload-completing', 'File upload completion is already in progress');
        }
        throw this.badRequest('core.file.upload-not-pending', 'File upload is not pending');
      } else {
        row.status = 'completing';
        row.uploadPendingAt = completionMarker;
        row.etag = staging!.etag;
      }
    } else {
      if (row.etag && staging!.etag && row.etag !== staging!.etag) {
        throw this.badRequest('core.file.upload-verification-failed', 'Uploaded staging version changed during completion');
      }
      const previousMarker = row.uploadPendingAt;
      if (previousMarker instanceof Date && previousMarker.getTime() > now.getTime()) {
        throw this.badRequest('core.file.upload-completing', 'File upload completion is already in progress');
      }
      const reclaimed = await this.repository.update(
        {
          ...this.lifecycleWhere(access, row.id),
          status: 'completing',
          uploadPendingAt: previousMarker ?? IsNull(),
          etag: row.etag ?? IsNull(),
        },
        { uploadPendingAt: completionMarker, etag: row.etag ?? staging!.etag },
      );
      if (reclaimed.affected !== 1) {
        const current = await this.repository.findOne({ where: this.lifecycleWhere(access, row.id) });
        if (current?.status === 'ready') return this.toUploadedFileResult(current);
        throw this.badRequest('core.file.upload-completing', 'File upload completion is already in progress');
      }
      row.uploadPendingAt = completionMarker;
      row.etag ??= staging!.etag;
    }

    let finalObject: Awaited<ReturnType<UploadedFileStorageDriver['headObject']>>;
    try {
      finalObject = await this.storage.headObject(row.key);
      if (!finalObject) {
        await this.storage.promoteObject({
          sourceKey: pendingKey,
          destinationKey: row.key,
          sourceEtag: staging!.etag,
          visibility: row.visibility,
          publicAccessMode: this.config.publicAccessMode,
        });
        finalObject = await this.storage.headObject(row.key);
      }
    } catch {
      await this.markCompletionRetryable(row, access, completionMarker);
      throw this.badRequest('core.file.upload-promotion-failed', 'Uploaded object could not be finalized');
    }
    if (!this.metadataMatches(row, finalObject)) {
      await this.markCompletionRetryable(row, access, completionMarker);
      throw this.badRequest('core.file.upload-verification-failed', 'Final uploaded object failed verification');
    }
    if (this.storage.kind === 'local') {
      try {
        // A crash can occur after the hard link is created but before the staging unlink finishes.
        // Keep the row retryable until that source path is definitely gone.
        await this.storage.deleteObject(pendingKey);
      } catch {
        await this.markCompletionRetryable(row, access, completionMarker);
        throw this.badRequest('core.file.upload-promotion-failed', 'Uploaded object could not be finalized');
      }
    }

    const completedAt = new Date();
    const expiredAt = row.isTemporary ? DateUtilities.addMilliseconds(completedAt, TEMPORARY_FILE_LIFETIME_MS) : null;
    if (row.isTemporary && !(expiredAt instanceof Date)) {
      throw this.badRequest('core.file.upload-failed', 'File upload failed');
    }
    let finalized: { affected?: number | null };
    try {
      finalized = await this.repository.update(
        { ...this.lifecycleWhere(access, row.id), status: 'completing', uploadPendingAt: completionMarker },
        {
          status: 'ready',
          uploadPendingAt: null,
          completedAt,
          expiredAt,
          etag: finalObject!.etag,
          ...(finalObject!.checksum ? { checksum: finalObject!.checksum } : {}),
          ...(this.storage.kind === 'local' ? { pendingKey: null } : {}),
        },
      );
    } catch {
      // The UPDATE can commit even when its response is lost. Confirm the exact durable state before
      // reporting failure or making the completion lease immediately retryable.
      const current = await this.repository.findOne({ where: this.lifecycleWhere(access, row.id) }).catch(() => null);
      if (current?.status === 'ready') return this.toUploadedFileResult(current);
      await this.markCompletionRetryable(row, access, completionMarker);
      throw this.badRequest('core.file.upload-failed', 'File upload failed');
    }
    if (finalized.affected !== 1) {
      const current = await this.repository.findOne({ where: this.lifecycleWhere(access, row.id) });
      if (!current || current.status !== 'ready') {
        throw this.badRequest('core.file.upload-failed', 'File upload failed');
      }
      return this.toUploadedFileResult(current);
    }
    row.status = 'ready';
    row.uploadPendingAt = null;
    row.completedAt = completedAt;
    row.expiredAt = expiredAt;
    row.etag = finalObject!.etag;
    if (finalObject!.checksum) row.checksum = finalObject!.checksum;
    if (this.storage.kind === 'local') row.pendingKey = null;
    return this.toUploadedFileResult(row);
  }

  /** Verify and atomically finalize one pending direct upload. Repeated ready calls are idempotent. */
  async completeUpload(id: string): Promise<UploadedFileResult> {
    const authorized = await this.findLifecycleAuthorized(id, 'complete');
    if ((authorized.row.status ?? 'ready') === 'ready') return this.toUploadedFileResult(authorized.row);
    const existing = this.completionPromises.get(authorized.row.id);
    if (existing) return existing;
    const completion = this.completeManagedUpload(authorized.row, authorized.access);
    this.completionPromises.set(authorized.row.id, completion);
    try {
      return await completion;
    } finally {
      if (this.completionPromises.get(authorized.row.id) === completion) this.completionPromises.delete(authorized.row.id);
    }
  }

  /** Canonical service-surface alias for {@link completeUpload}. */
  async complete(id: string): Promise<UploadedFileResult> {
    return this.completeUpload(id);
  }

  /** Resolve a ready object's public, protected-local, or time-bounded private URL. */
  async resolveUrl(id: string): Promise<{ url: string; urlExpiredAt: Date | null }> {
    const row = await this.findAuthorized(id, 'read');
    return this.resolveRowUrl(row);
  }

  /** Accept bytes at the provider-neutral local upload target, then run normal completion. */
  async putUploadContent(id: string, buffer: Buffer): Promise<UploadedFileResult> {
    if (this.storage.kind !== 'local') throw this.notFound();
    const { row } = await this.findLifecycleAuthorized(id, 'complete');
    if (
      row.status !== 'pending' ||
      !row.pendingKey ||
      !(row.uploadExpiredAt instanceof Date) ||
      Date.now() >= row.uploadExpiredAt.getTime()
    ) {
      throw this.badRequest('core.file.upload-expired', 'File upload has expired');
    }
    try {
      validateUploadBuffer(
        buffer,
        row.fileName,
        row.contentType ?? undefined,
        this.config.allowedMimeTypes,
        this.config.validateMagicBytes,
        row.sizeBytes ?? this.config.maxFileSizeBytes,
      );
      if (buffer.byteLength !== row.sizeBytes) throw new Error('Upload size mismatch');
      await this.storage.putObject(row.pendingKey, buffer, {
        contentType: row.contentType ?? 'application/octet-stream',
        contentDisposition: contentDisposition(row.fileName, row.disposition ?? 'attachment'),
      });
    } catch {
      throw this.badRequest('core.file.invalid-upload', 'Uploaded file failed validation');
    }
    return this.completeUpload(id);
  }

  /** Abort a pending upload and persist retryable object-deletion state before storage I/O. */
  async abortUpload(id: string): Promise<void> {
    const { access, row } = await this.findLifecycleAuthorized(id, 'abort');
    if (row.status !== 'pending' && row.status !== 'completing') {
      throw this.badRequest('core.file.upload-not-pending', 'File upload is not pending');
    }
    if (this.completionIsActive(row)) {
      throw this.badRequest('core.file.upload-completing', 'File upload completion is already in progress');
    }
    const claim = this.nextDeletionClaim(row.uploadPendingAt ?? undefined);
    const claimed = await this.repository.update(
      {
        ...this.lifecycleWhere(access, row.id),
        status: row.status,
        uploadPendingAt: row.uploadPendingAt ?? IsNull(),
      },
      { status: 'failed', uploadPendingAt: null, deletionPendingAt: claim },
    );
    if (claimed.affected !== 1) throw this.notFound();
    row.status = 'failed';
    row.uploadPendingAt = null;
    row.deletionPendingAt = claim;
    try {
      await this.deleteAndFinalizePendingRows([row], claim, access);
    } catch {
      throw this.badRequest('core.file.cleanup-failed', 'File cleanup failed');
    }
  }

  /** Canonical service-surface alias for {@link abortUpload}. */
  async abort(id: string): Promise<void> {
    return this.abortUpload(id);
  }

  private isManagedUploadCall(
    source: UploadedFileStorageSource,
    ownerOrExtraData: unknown,
    options: UploadedFileUploadOptions | undefined,
  ): boolean {
    return (
      !Buffer.isBuffer(source) ||
      typeof ownerOrExtraData === 'string' ||
      options?.visibility !== undefined ||
      options?.disposition !== undefined ||
      options?.size !== undefined
    );
  }

  private async uploadManaged(
    source: UploadedFileStorageSource,
    originalName: string,
    context: UploadedFileContext | undefined,
    ownerId: string | undefined,
    options: UploadedFileUploadOptions | undefined,
    temporary: boolean,
  ): Promise<UploadedFileResult> {
    const access = await this.authorize('create');
    this.verifyRequestedOwner(ownerId, access);
    const buffered = Buffer.isBuffer(source) || source instanceof Uint8Array ? Buffer.from(source) : null;
    let size: number;
    let contentType: string;
    if (buffered) {
      let validated: ReturnType<typeof validateUploadBuffer>;
      try {
        const limits = this.uploadValidationLimits(options);
        validated = validateUploadBuffer(
          buffered,
          originalName,
          options?.contentType,
          limits.allowedMimeTypes,
          this.config.validateMagicBytes,
          limits.maxFileSizeBytes,
        );
        if (options?.size !== undefined && options.size !== buffered.byteLength) throw new Error('Upload size mismatch');
      } catch {
        throw this.badRequest('core.file.invalid-upload', 'Uploaded file failed validation');
      }
      originalName = validated.originalName;
      contentType = validated.contentType;
      size = buffered.byteLength;
      source = buffered;
    } else {
      if (!Number.isSafeInteger(options?.size) || (options?.size ?? 0) <= 0 || !options?.contentType) {
        throw this.badRequest('core.file.invalid-upload', 'Readable uploads require a known exact size and content type');
      }
      size = options!.size!;
      contentType = options!.contentType!;
    }

    let initiated: InitiateUploadedFileResult | undefined;
    try {
      initiated = await this.initiateManagedUpload(
        { originalName, contentType, size },
        {
          access,
          context,
          ownerId,
          visibility: temporary ? 'private' : (options?.visibility ?? this.config.defaultVisibility),
          disposition: options?.disposition,
          temporary,
          limits: options,
        },
      );
      if (this.storage.kind === 'local') {
        if (!buffered) {
          const { row } = await this.findLifecycleAuthorized(initiated.id, 'complete');
          await this.storage.putObject(row.pendingKey!, source, {
            contentType,
            contentDisposition: contentDisposition(originalName, options?.disposition ?? 'attachment'),
          });
          return this.completeUpload(initiated.id);
        }
        return this.putUploadContent(initiated.id, buffered);
      }

      const request: RequestInit & { duplex?: 'half' } = {
        method: initiated.upload.method,
        headers: initiated.upload.headers,
        body: source as RequestInit['body'],
      };
      if (!buffered) request.duplex = 'half';
      const response = await fetch(initiated.upload.url, request);
      if (!response.ok) throw new Error(`Signed upload returned HTTP ${response.status}`);
      return await this.completeUpload(initiated.id);
    } catch (error) {
      if (initiated) await this.abortUpload(initiated.id).catch(() => undefined);
      throw error;
    }
  }

  async upload<TExtraData = Record<string, unknown>>(
    buffer: Buffer,
    fileName?: string,
    meta?: UploadedFileMeta,
    extraData?: Partial<TExtraData>,
    options?: UploadedFileUploadOptions,
  ): Promise<UploadedFile<TExtraData>>;
  async upload(
    source: UploadedFileStorageSource,
    originalName: string,
    context: UploadedFileContext | undefined,
    ownerId: string | undefined,
    options?: UploadedFileUploadOptions,
  ): Promise<UploadedFileResult>;
  async upload<TExtraData = Record<string, unknown>>(
    source: UploadedFileStorageSource,
    fileName?: string,
    contextOrMeta?: UploadedFileContext,
    ownerOrExtraData?: string | Partial<TExtraData>,
    options?: UploadedFileUploadOptions,
  ): Promise<UploadedFile<TExtraData> | UploadedFileResult> {
    if (this.isManagedUploadCall(source, ownerOrExtraData, options)) {
      return this.uploadManaged(
        source,
        fileName ?? 'TEMP',
        contextOrMeta,
        typeof ownerOrExtraData === 'string' ? ownerOrExtraData : undefined,
        options,
        false,
      );
    }
    return this.uploadLegacy(source as Buffer, fileName, contextOrMeta, ownerOrExtraData as Partial<TExtraData> | undefined, options);
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
  private async uploadLegacy<TExtraData = Record<string, unknown>>(
    buffer: Buffer,
    fileName?: string,
    meta?: UploadedFileMeta,
    extraData?: Partial<TExtraData>,
    options?: UploadedFileUploadOptions,
  ): Promise<UploadedFile<TExtraData>> {
    const access = await this.authorize('create');
    let validated: ReturnType<typeof validateUploadBuffer>;
    try {
      const limits = this.uploadValidationLimits(options);
      validated = validateUploadBuffer(
        buffer,
        fileName,
        options?.contentType,
        limits.allowedMimeTypes,
        this.config.validateMagicBytes,
        limits.maxFileSizeBytes,
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
      sizeBytes: buffer.byteLength,
      contentType: validated.contentType,
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

  async uploadTemporary(buffer: Buffer, fileName?: string, options?: UploadedFileUploadOptions): Promise<{ key: string; cdn: string }>;
  async uploadTemporary(
    source: UploadedFileStorageSource,
    originalName: string,
    context: UploadedFileContext | undefined,
    ownerId: string | undefined,
    options?: UploadedFileTemporaryUploadOptions,
  ): Promise<UploadedFileResult>;
  async uploadTemporary(
    source: UploadedFileStorageSource,
    fileName?: string,
    contextOrLegacyOptions?: UploadedFileContext | UploadedFileUploadOptions,
    ownerId?: string,
    options?: UploadedFileTemporaryUploadOptions,
  ): Promise<{ key: string; cdn: string } | UploadedFileResult> {
    const managed = !Buffer.isBuffer(source) || arguments.length >= 4;
    if (!managed) {
      return this.uploadTemporaryLegacy(source as Buffer, fileName, contextOrLegacyOptions as UploadedFileUploadOptions | undefined);
    }
    const runtimeOptions = options as (UploadedFileTemporaryUploadOptions & Record<string, unknown>) | undefined;
    if (runtimeOptions?.visibility !== undefined || runtimeOptions?.expiredAt !== undefined || runtimeOptions?.ttlSeconds !== undefined) {
      throw this.badRequest('core.file.invalid-temporary-options', 'Temporary file visibility and lifetime cannot be overridden');
    }
    return this.uploadManaged(
      source,
      fileName ?? 'TEMP',
      contextOrLegacyOptions as UploadedFileContext | undefined,
      ownerId,
      runtimeOptions,
      true,
    );
  }

  /**
   * Store a validated temporary upload as a tracked, unused database row.
   *
   * This compatibility overload retains its historical positive-cleanup configuration gate and
   * `{ key, cdn }` result. Like managed temporary uploads, it is private, persists hidden pending
   * state before storage I/O, and atomically activates with `expiredAt = completedAt + 24h`. Any
   * failed write or activation retains durable cleanup state. Requires authorized `create` access
   * for the current tenant/owner scope.
   */
  private async uploadTemporaryLegacy(
    buffer: Buffer,
    fileName?: string,
    options?: UploadedFileUploadOptions,
  ): Promise<{ key: string; cdn: string }> {
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
      const limits = this.uploadValidationLimits(options);
      validated = validateUploadBuffer(
        buffer,
        fileName,
        options?.contentType,
        limits.allowedMimeTypes,
        this.config.validateMagicBytes,
        limits.maxFileSizeBytes,
      );
    } catch {
      throw this.badRequest('core.file.invalid-upload', 'Uploaded file failed validation');
    }
    const generated = buildStorageKey(this.config.folder, access.scope.tenantCode, validated.originalName, 'temporary');
    // Temporary objects remain private even when legacy `publicFiles` normalized permanent uploads
    // to public visibility.
    const cdn = this.privateDownloadUrl(generated.id);
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
      visibility: 'private',
      status: 'pending',
      isTemporary: true,
      uploadExpiredAt: null,
      expiredAt: null,
      completedAt: null,
      disposition: 'attachment',
      checksum: null,
      etag: null,
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
      await this.activateTemporaryPendingUpload(saved, access, activationMarker);
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
    if (operation === 'read') this.assertReadyAndUnexpired(row);
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
   * Open one exact, already-used domain attachment after an explicit consumer policy approves it.
   *
   * The request tenant comes only from trusted context. The lookup deliberately ignores uploader
   * identity but requires exact active-row ownership metadata, so generic owner-based downloads are
   * not widened. Missing policy, policy denial, metadata mismatch, and storage failure are
   * indistinguishable.
   */
  async downloadAttached(id: string, attachment: UploadedFileAttachment): Promise<{ stream: Readable; fileName: string }> {
    const resourceId = this.resourceId(id);
    const context = this.currentContext();
    const scope = this.resolveScope(context);
    const normalizedAttachment = this.normalizeAttachment(attachment);
    let approved = false;
    try {
      approved =
        (await this.config.attachedReadPolicy?.({
          context,
          scope,
          resourceId,
          attachment: normalizedAttachment,
        })) === true;
    } catch {
      approved = false;
    }
    if (!approved) throw this.notFound();

    const row = await this.repository.findOne({
      where: {
        id: resourceId,
        tenantCode: scope.tenantCode,
        isUsed: true,
        module: normalizedAttachment.module,
        entity: normalizedAttachment.entity,
        entityId: normalizedAttachment.entityId,
        deletedAt: IsNull(),
        uploadPendingAt: IsNull(),
        deletionPendingAt: IsNull(),
      },
    });
    if (!row) throw this.notFound();
    this.assertReadyAndUnexpired(row);
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

  /** Return the new URL-aware service projection while retaining {@link findById} for legacy callers. */
  async find(id: string): Promise<UploadedFileResult> {
    const { row } = await this.findLifecycleAuthorized(id, 'read');
    if ((row.status ?? 'ready') !== 'ready') {
      return this.uploadedFileResult(row, { url: null, urlExpiredAt: null });
    }
    return this.toUploadedFileResult(row);
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

  private async mutateIdsWithManager(
    manager: EntityManager,
    access: AuthorizedAccess,
    ids: readonly string[],
    meta: UploadedFileMeta,
  ): Promise<void> {
    const repository = manager.getRepository(UploadedFile);
    const criteria = this.where(access, { id: In(ids) });
    const rows = await repository.find({ where: criteria, select: { id: true } });
    if (rows.length !== ids.length) throw this.notFound();
    const result = await repository.update(criteria, { isUsed: true, ...meta });
    if (result.affected !== ids.length) throw this.notFound();
  }

  /**
   * Mark a bounded batch of file UUIDs as used and optionally attach normalized metadata.
   * Duplicate IDs are collapsed. Every requested row must be authorized and present; row
   * verification and mutation run with all-or-nothing transaction semantics. An empty batch is a
   * no-op, while malformed or over-limit batches fail without enumerating individual resources.
   */
  async markUsed(ids: string[], meta?: UploadedFileMeta, manager?: EntityManager): Promise<void> {
    const unique = this.batchIds(ids);
    if (!unique.length) return;
    const access = await this.authorize('mark-used', unique);
    const safeMeta = this.normalizeMeta(meta);
    if (manager) {
      await this.mutateIdsWithManager(manager, access, unique, safeMeta);
      return;
    }
    await this.repository.manager.transaction((transactionManager) =>
      this.mutateIdsWithManager(transactionManager, access, unique, safeMeta),
    );
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

  /** Durably delete one file by UUID without accepting a client-controlled storage reference. */
  async deleteById(id: string): Promise<void> {
    const resourceId = this.resourceId(id);
    const access = await this.authorize('delete', [resourceId]);
    const claim = this.nextDeletionClaim();
    const row = await this.repository.manager.transaction(async (manager) => {
      const repository = manager.getRepository(UploadedFile);
      const current = await repository.findOne({ where: this.lifecycleWhere(access, resourceId) });
      if (!current) throw this.notFound();
      if (this.completionIsActive(current)) {
        throw this.badRequest('core.file.upload-completing', 'File upload completion is already in progress');
      }
      const result = await repository.update(
        {
          ...this.lifecycleWhere(access, resourceId),
          uploadPendingAt: current.uploadPendingAt ?? IsNull(),
          status: current.status,
        },
        { status: current.status === 'ready' ? 'ready' : 'failed', uploadPendingAt: null, deletionPendingAt: claim },
      );
      if (result.affected !== 1) throw this.notFound();
      current.uploadPendingAt = null;
      current.deletionPendingAt = claim;
      if (current.status !== 'ready') current.status = 'failed';
      return current;
    });
    try {
      await this.deleteAndFinalizePendingRows([row], claim, access);
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
      const keys = Array.from(
        new Set(
          rows
            .flatMap(({ key, pendingKey }) => [key, pendingKey])
            .filter((value): value is string => typeof value === 'string' && value.length > 0),
        ),
      );
      await this.storage.delete(keys);
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

  private async unsafeSystemCleanupExpiredDirectUploads(limit: number): Promise<number> {
    const now = new Date();
    const take = this.systemDeletionLimit(limit);
    const rows = await this.repository.find({
      where: [
        {
          status: In(['pending', 'completing']),
          pendingKey: Not(IsNull()),
          uploadExpiredAt: LessThanOrEqual(now),
          uploadPendingAt: LessThanOrEqual(now),
          deletionPendingAt: IsNull(),
        },
        {
          status: In(['pending', 'completing']),
          pendingKey: Not(IsNull()),
          uploadExpiredAt: LessThanOrEqual(now),
          uploadPendingAt: LessThanOrEqual(now),
          deletionPendingAt: LessThan(now),
        },
      ],
      order: { uploadPendingAt: 'ASC' },
      take,
      withDeleted: true,
    });
    let finalized = 0;
    for (const row of rows) {
      if (!(row.uploadPendingAt instanceof Date)) continue;
      const previousDeletionMarker = row.deletionPendingAt;
      const claim = this.nextDeletionClaim(previousDeletionMarker ?? row.uploadPendingAt);
      const claimed = await this.repository.update(
        {
          id: row.id,
          status: row.status,
          deletedAt: row.deletedAt instanceof Date ? row.deletedAt : IsNull(),
          uploadPendingAt: row.uploadPendingAt,
          deletionPendingAt: previousDeletionMarker instanceof Date ? previousDeletionMarker : IsNull(),
        },
        {
          status: 'failed',
          uploadPendingAt: null,
          deletionPendingAt: claim,
          ...(row.deletedAt instanceof Date ? { deletedAt: null } : {}),
        } as unknown as QueryDeepPartialEntity<UploadedFile>,
      );
      if (claimed.affected !== 1) continue;
      row.status = 'failed';
      row.deletedAt = null as unknown as Date;
      row.uploadPendingAt = null;
      row.deletionPendingAt = claim;
      try {
        finalized += await this.deleteAndFinalizePendingRows([row], claim);
      } catch {
        this.logger.error('Expired direct-upload cleanup remains pending for retry');
      }
    }
    return finalized;
  }

  /**
   * Delete retained S3 staging objects after their upload URL and recovery window have elapsed.
   * Duplicate storage deletes are harmless; the final `pendingKey = null` write is an exact CAS.
   *
   * @internal Trusted maintenance boundary; performs no request authorization.
   */
  async unsafeSystemCleanupCompletedStaging(limit = this.config.cleanupBatchSize): Promise<number> {
    const now = new Date();
    const rows = await this.repository.find({
      where: {
        status: 'ready',
        pendingKey: Not(IsNull()),
        uploadExpiredAt: LessThanOrEqual(now),
        deletedAt: IsNull(),
        deletionPendingAt: IsNull(),
      },
      order: { uploadExpiredAt: 'ASC' },
      take: this.systemDeletionLimit(limit),
    });
    let cleaned = 0;
    for (const row of rows) {
      const pendingKey = row.pendingKey;
      if (!pendingKey) continue;
      try {
        await this.storage.deleteObject(pendingKey);
        const cleared = await this.repository.update(
          { id: row.id, status: 'ready', pendingKey, deletedAt: IsNull(), deletionPendingAt: IsNull() },
          { pendingKey: null },
        );
        cleaned += cleared.affected ?? 0;
      } catch {
        this.logger.error('Completed-upload staging cleanup will be retried');
      }
    }
    return cleaned;
  }

  /**
   * Claim and delete expired ready temporary files. Expiry enforcement does not depend on this
   * sweep; reads already fail at `now >= expiredAt`. Claims are exact CAS writes and failures remain
   * in the durable deletion outbox for another instance/run.
   *
   * @internal Trusted maintenance boundary; performs no request authorization.
   */
  async cleanupExpiredTemporaryFiles(now = new Date(), limit = this.config.cleanupBatchSize): Promise<number> {
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new Error('Invalid temporary cleanup time');
    const rows = await this.repository.find({
      where: {
        status: 'ready',
        isTemporary: true,
        expiredAt: LessThanOrEqual(now),
        deletedAt: IsNull(),
        uploadPendingAt: IsNull(),
        deletionPendingAt: IsNull(),
      },
      order: { expiredAt: 'ASC' },
      take: this.systemDeletionLimit(limit),
    });
    let finalized = 0;
    for (const row of rows) {
      const claim = this.nextDeletionClaim(row.expiredAt ?? undefined);
      const claimed = await this.repository.update(
        {
          id: row.id,
          status: 'ready',
          isTemporary: true,
          expiredAt: row.expiredAt ?? IsNull(),
          deletedAt: IsNull(),
          uploadPendingAt: IsNull(),
          deletionPendingAt: IsNull(),
        },
        { deletionPendingAt: claim },
      );
      if (claimed.affected !== 1) continue;
      row.deletionPendingAt = claim;
      try {
        finalized += await this.deleteAndFinalizePendingRows([row], claim);
      } catch {
        this.logger.error('Expired temporary-file cleanup remains pending for retry');
      }
    }
    return finalized;
  }

  /** Canonical service-surface name for temporary cleanup. */
  async cleanupExpiredTemporary(now = new Date(), limit = this.config.cleanupBatchSize): Promise<number> {
    return this.cleanupExpiredTemporaryFiles(now, limit);
  }

  /**
   * Run one bounded pending/retry sweep: expired direct uploads, retained staging, then the legacy
   * durable deletion queue. This is intentionally provider-neutral and safe for concurrent workers.
   *
   * @internal Trusted maintenance boundary; performs no request authorization.
   */
  async cleanupPendingUploads(limit = this.config.cleanupBatchSize): Promise<number> {
    const bounded = this.systemDeletionLimit(limit);
    const expired = await this.unsafeSystemCleanupExpiredDirectUploads(bounded);
    const staged = await this.unsafeSystemCleanupCompletedStaging(bounded);
    const retried = await this.unsafeSystemRetryPendingDeletions(bounded);
    return expired + staged + retried;
  }

  /** Canonical service-surface name for pending cleanup. */
  async cleanupPending(limit = this.config.cleanupBatchSize): Promise<number> {
    return this.cleanupPendingUploads(limit);
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
        isTemporary: false,
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
