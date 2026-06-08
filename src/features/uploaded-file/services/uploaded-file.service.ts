import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import type { Readable } from 'node:stream';
import type { DeepPartial, Repository } from 'typeorm';
import { apiError } from '../../../core/orm/types/api-response.types';
import { ContextService } from '../../../core/context/context.service';
import { UploadedFile } from '../uploaded-file.entity';
import { IUploadedFileStorage, type UploadedFileMeta } from '../types';

/**
 * Tracks uploaded-file rows + their usage, and provides the upload/download conveniences a consumer
 * needs so they only have to declare a thin controller (no per-app file service). The storage driver
 * ({@link IUploadedFileStorage}) is resolved lazily via {@link ModuleRef} to break the
 * service↔driver DI cycle (the driver injects this service).
 *
 * `TExtraData` (per method) types the `extraData` jsonb bag; defaults to a loose record.
 */
@Injectable()
export class UploadedFileService {
  private readonly logger = new Logger(UploadedFileService.name);

  constructor(
    @InjectRepository(UploadedFile) private readonly repository: Repository<UploadedFile>,
    private readonly moduleRef: ModuleRef,
    @Optional() private readonly context?: ContextService,
  ) {}

  private get storage(): IUploadedFileStorage {
    return this.moduleRef.get<IUploadedFileStorage>(IUploadedFileStorage, { strict: false });
  }

  getContent(fileName?: string): { ContentType?: string; ContentDisposition?: string } {
    const ext = fileName?.toLowerCase().split('.').pop();
    const inlineTypes: Record<string, string> = {
      json: 'application/json',
      pdf: 'application/pdf',
      png: 'image/png',
      jpeg: 'image/jpeg',
      jpg: 'image/jpeg',
      gif: 'image/gif',
      bmp: 'image/bmp',
      mp4: 'video/mp4',
    };
    const ContentType = ext ? inlineTypes[ext] : undefined;
    return ContentType ? { ContentType, ContentDisposition: 'inline' } : {};
  }

  /**
   * Upload a buffer via the configured storage driver, persist the tracking row, and return it.
   * `extraData` (when given) is stamped onto the new row. Returns the full {@link UploadedFile}.
   */
  async upload<TExtraData = Record<string, unknown>>(
    buffer: Buffer,
    fileName?: string,
    meta?: UploadedFileMeta,
    extraData?: Partial<TExtraData>,
  ): Promise<UploadedFile<TExtraData>> {
    const result = await this.storage.upload(buffer, fileName, meta);
    if (extraData) await this.setExtraData<TExtraData>(result.id, extraData);
    const row = await this.findById<TExtraData>(result.id);
    if (!row) throw new BadRequestException(apiError('core.file.not-found', 'Uploaded file not found', { id: result.id }));
    return row;
  }

  /** Resolve a row by id and stream its bytes from the storage driver. Throws 400 if the id is unknown. */
  async download(id: string): Promise<{ stream: Readable; fileName: string }> {
    const row = await this.findById(id);
    if (!row) throw new BadRequestException(apiError('core.file.not-found', 'File not found', { id }));
    return { stream: this.storage.download(row.key), fileName: row.fileName };
  }

  async findById<TExtraData = Record<string, unknown>>(id: string): Promise<UploadedFile<TExtraData> | null> {
    return this.repository.findOne({ where: { id } }) as unknown as Promise<UploadedFile<TExtraData> | null>;
  }

  /** Replace the `extraData` bag for a row (no-op if `ids` is unknown — `update` matches 0 rows). */
  async setExtraData<TExtraData = Record<string, unknown>>(id: string, extraData: Partial<TExtraData>): Promise<void> {
    await this.repository.update({ id }, { extraData } as unknown as Parameters<Repository<UploadedFile>['update']>[1]);
  }

  async create<TExtraData = Record<string, unknown>>(
    args: {
      fileName: string;
      fileSize: number;
      key: string;
      cdn: string;
      extraData?: Partial<TExtraData>;
    } & UploadedFileMeta,
  ): Promise<UploadedFile<TExtraData>> {
    const { fileName, fileSize, key, cdn, module, entity, entityId, type, extraData } = args;
    const row = this.repository.create({
      fileName,
      fileSize,
      fileExtension: fileName?.split('.').pop(),
      key,
      cdn,
      module,
      entity,
      entityId,
      type,
      extraData,
      tenantCode: this.context?.getCustom<string>('tenantCode') ?? this.context?.tenant,
      departmentCode: this.context?.getCustom<string>('departmentCode'),
      userId: this.context?.userId,
    } as DeepPartial<UploadedFile>);
    return this.repository.save(row) as unknown as Promise<UploadedFile<TExtraData>>;
  }

  async useFiles(keys: string[], entity?: string, entityId?: string): Promise<void> {
    if (!keys?.length) return;
    await this.repository
      .createQueryBuilder()
      .update({ entity, entityId, isUsed: true })
      .where('"deletedAt" IS NULL AND "isUsed" = :isUsed AND "key" IN (:...keys)', { isUsed: false, keys })
      .execute()
      .catch((err) => this.logger.warn(`useFiles failed: ${String(err)}`));
  }

  /** Flip `isUsed` for the given `uploaded_file` ids; stamps any defined meta fields. */
  async markUsed(ids: string[], meta?: UploadedFileMeta): Promise<void> {
    if (!ids?.length) return;
    const set: Record<string, unknown> = { isUsed: true };
    for (const [k, v] of Object.entries(meta ?? {})) {
      if (v !== undefined) set[k] = v;
    }
    await this.repository
      .createQueryBuilder()
      .update(set)
      .where('"deletedAt" IS NULL AND "id" IN (:...ids)', { ids })
      .execute()
      .catch((err) => this.logger.warn(`markUsed failed: ${String(err)}`));
  }

  async delete(keys: string[]): Promise<void> {
    if (!keys?.length) return;
    const rows = await this.repository.createQueryBuilder('e').where('e."deletedAt" IS NULL AND e."key" IN (:...keys)', { keys }).getMany();
    if (rows.length) {
      await this.repository.softDelete(rows.map((e) => e.id));
    }
  }
}
