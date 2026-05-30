import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { ContextService } from '../context/context.service';
import { UploadedFile } from './uploaded-file.entity';

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

  create(args: { fileName: string; fileSize: number; key: string; cdn: string }): void {
    const { fileName, fileSize, key, cdn } = args;
    const entity = this.repository.create({
      fileName,
      fileSize,
      fileExtension: fileName?.split('.').pop(),
      key,
      cdn,
      tenantCode: this.context?.getCustom<string>('tenantCode') ?? this.context?.tenant,
      departmentCode: this.context?.getCustom<string>('departmentCode'),
      userId: this.context?.userId,
    });
    void this.repository.save(entity);
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

  async delete(keys: string[]): Promise<void> {
    if (!keys?.length) return;
    const rows = await this.repository
      .createQueryBuilder('e')
      .where('e."deletedAt" IS NULL AND e."key" IN (:...keys)', { keys })
      .getMany();
    if (rows.length) {
      await this.repository.softDelete(rows.map((e) => e.id));
    }
  }
}
