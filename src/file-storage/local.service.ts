import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { createReadStream, existsSync, mkdirSync, unlink, writeFileSync } from 'node:fs';
import type { Readable } from 'node:stream';
import { apiError } from '../orm/types/api-response.types';
import { FILE_STORAGE_CONFIG, type FileStorageConfig, type IFileStorageService, type UploadResult } from './types';
import { UploadedFileService } from './uploaded-file.service';
import { isBlank, slugify, toMb } from './utils';

/** Local-disk {@link IFileStorageService}. Files live under `<cwd>/upload/<folder>`. */
@Injectable()
export class LocalFileStorageService implements IFileStorageService {
  private readonly logger = new Logger(LocalFileStorageService.name);
  private readonly folder: string;
  private readonly host: string;
  private readonly prefixFolder = 'upload';
  private readonly tempFolder = 'temporary';

  private get basePath(): string {
    return `${process.cwd()}/${this.prefixFolder}`;
  }

  constructor(
    @Inject(FILE_STORAGE_CONFIG) config: FileStorageConfig,
    private readonly uploadedFileService: UploadedFileService,
  ) {
    this.folder = config.folder || 'core';
    this.host = config.host ?? '';
    for (const dir of [`${this.basePath}/${this.folder}`, `${this.basePath}/${this.tempFolder}`]) {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }
  }

  private cdn(key: string): string {
    return `${this.host}file-storage/${key}`;
  }

  upload(buffer: Buffer, fileName?: string): Promise<UploadResult> {
    const key = `${this.folder}/${slugify(fileName || 'TEMP')}`;
    try {
      writeFileSync(`${this.basePath}/${key}`, buffer);
      const fileSize = toMb(buffer.byteLength);
      const cdn = this.cdn(key);
      this.uploadedFileService.create({ fileName: fileName!, fileSize, key, cdn });
      return Promise.resolve({ fileName: fileName!, fileSize, key, cdn });
    } catch (error) {
      throw new BadRequestException(apiError('core.file.upload-failed', 'File upload failed', { error: String(error) }));
    }
  }

  async cloneFromUrl(url: string, fileName?: string): Promise<UploadResult> {
    const res = await axios.get<ArrayBuffer>(url, { responseType: 'arraybuffer' });
    return this.upload(Buffer.from(res.data), fileName || url.split('/').pop());
  }

  uploadTemporary(buffer: Buffer, fileName?: string): Promise<{ key: string; cdn: string }> {
    const key = `${this.tempFolder}/${slugify(fileName || 'TEMP')}`;
    try {
      writeFileSync(`${this.basePath}/${key}`, buffer);
      return Promise.resolve({ key, cdn: this.cdn(key) });
    } catch (error) {
      throw new BadRequestException(apiError('core.file.upload-failed', 'File upload failed', { error: String(error) }));
    }
  }

  download(key: string): Readable {
    if (!key.startsWith(this.folder) && !key.startsWith(this.tempFolder)) key = `${this.folder}/${key}`;
    return createReadStream(`${this.basePath}/${key}`);
  }

  downloadByFolder(folder: string, key: string): Readable {
    return createReadStream(`${this.basePath}/${folder}/${key}`);
  }

  private normalizeKeys(keyOrCdns: string[]): string[] {
    return keyOrCdns
      .filter((val) => val?.includes(`${this.folder}/`))
      .map((val) => `${this.folder}/${val.split(`${this.folder}/`).pop()}`);
  }

  async useFiles(keyOrCdns: string[], entity?: string, entityId?: string): Promise<void> {
    if (!Array.isArray(keyOrCdns)) return;
    await this.uploadedFileService.useFiles(this.normalizeKeys(keyOrCdns), entity, entityId);
  }

  async changeFiles(olds: string[], news: string[], entity?: string, entityId?: string): Promise<void> {
    if (Array.isArray(news)) await this.useFiles(news, entity, entityId);
    if (!Array.isArray(olds) || !Array.isArray(news)) return;
    const removed = olds.filter((v) => !isBlank(v)).filter((key) => !news.includes(key));
    const keys = this.normalizeKeys(removed);
    if (!keys.length) return;
    await Promise.all(
      keys.map(
        (item) =>
          new Promise<void>((resolve, reject) =>
            unlink(`${this.basePath}/${item}`, (err) => (err ? reject(err) : resolve())),
          ),
      ),
    )
      .then(() => this.uploadedFileService.delete(keys))
      .catch((err) => this.logger.warn(`changeFiles failed: ${String(err)}`));
  }
}
