import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { ContextService } from '../../../core/context/context.service';
import { UploadedFile } from '../uploaded-file.entity';
import type { UploadedFileMeta } from '../types';

/** Tracks uploaded-file rows + their usage; supplies HTTP content headers by extension. */
@Injectable()
export class UploadedFileService {
  private readonly logger = new Logger(UploadedFileService.name);

  constructor(
    @InjectRepository(UploadedFile) private readonly repository: Repository<UploadedFile>,
    @Optional() private readonly context?: ContextService,
  ) {}

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

  async create(
    args: {
      fileName: string;
      fileSize: number;
      key: string;
      cdn: string;
    } & UploadedFileMeta,
  ): Promise<UploadedFile> {
    const { fileName, fileSize, key, cdn, module, entity, entityId, type } = args;
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
      tenantCode: this.context?.getCustom<string>('tenantCode') ?? this.context?.tenant,
      departmentCode: this.context?.getCustom<string>('departmentCode'),
      userId: this.context?.userId,
    });
    return this.repository.save(row);
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
