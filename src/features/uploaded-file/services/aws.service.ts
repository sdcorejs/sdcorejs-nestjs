import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import type { Readable } from 'node:stream';
import { apiError } from '../../../core/orm/types/api-response.types';
import {
  UPLOADED_FILE_CONFIG,
  type UploadedFileConfig,
  type UploadedFileMeta,
  type IUploadedFileStorage,
  type UploadedFileResult,
} from '../types';
import { UploadedFileService } from './uploaded-file.service';
import { ArrayUtilities } from '@sdcorejs/utils/fns';
import { addDays, isBlank, slugify, toMb } from '../utils';

/** Minimal slice of the aws-sdk v2 S3 client used here (lazy-loaded — optional peer dep). */
interface S3Like {
  upload(params: Record<string, unknown>, cb: (err: Error | null) => void): void;
  getObject(params: Record<string, unknown>): { createReadStream(): Readable };
  deleteObjects(params: Record<string, unknown>, cb: (err: Error | null, data: unknown) => void): void;
}

/** S3-backed {@link IUploadedFileStorage}. Requires the optional peer dep `aws-sdk`. */
@Injectable()
export class AwsUploadedFileStorage implements IUploadedFileStorage {
  private readonly logger = new Logger(AwsUploadedFileStorage.name);
  private readonly s3: S3Like;
  private readonly bucket: string;
  private readonly folder: string;
  private readonly tempFolder = 'temporary';
  private readonly cdnBaseUrl: string;

  constructor(
    @Inject(UPLOADED_FILE_CONFIG) config: UploadedFileConfig,
    private readonly uploadedFileService: UploadedFileService,
  ) {
    const { accessId, accessKey, bucket, folder, cdnBaseUrl } = config;
    this.bucket = bucket ?? '';
    this.folder = folder || 'core';
    this.cdnBaseUrl = cdnBaseUrl ?? '';
    let S3Ctor: new (opts: Record<string, unknown>) => S3Like;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      S3Ctor = (require('aws-sdk') as { S3: new (o: Record<string, unknown>) => S3Like }).S3;
    } catch {
      throw new Error("@sdcorejs/nestjs uploaded-file S3 driver requires 'aws-sdk'. Install it: npm i aws-sdk");
    }
    this.s3 = new S3Ctor({ accessKeyId: accessId, secretAccessKey: accessKey });
  }

  private cdn(key: string): string {
    return `${this.cdnBaseUrl}${key}`;
  }

  async upload(buffer: Buffer, fileName?: string, meta?: UploadedFileMeta): Promise<UploadedFileResult> {
    const name = fileName || 'TEMP';
    const key = `${this.folder}/${slugify(name)}`;
    const { ContentType, ContentDisposition } = this.uploadedFileService.getContent(fileName);
    await new Promise<void>((resolve, reject) => {
      this.s3.upload({ Bucket: this.bucket, ContentType, ContentDisposition, Key: key, Body: buffer }, (err) =>
        err
          ? reject(new BadRequestException(apiError('core.file.upload-failed', 'File upload failed', { error: String(err) })))
          : resolve(),
      );
    });
    const fileSize = toMb(buffer.byteLength);
    const cdn = this.cdn(key);
    const row = await this.uploadedFileService.create({ fileName: name, fileSize, key, cdn, ...meta });
    return { id: row.id, fileName: name, fileSize, key, cdn };
  }

  async cloneFromUrl(url: string, fileName?: string): Promise<UploadedFileResult> {
    const res = await axios.get<ArrayBuffer>(url, { responseType: 'arraybuffer' });
    return this.upload(Buffer.from(res.data), fileName || url.split('/').pop());
  }

  uploadTemporary(buffer: Buffer, fileName?: string): Promise<{ key: string; cdn: string }> {
    const key = `${this.tempFolder}/${slugify(fileName || 'TEMP')}`;
    const { ContentType, ContentDisposition } = this.uploadedFileService.getContent(fileName);
    return new Promise((resolve, reject) => {
      this.s3.upload(
        { Bucket: this.bucket, Key: key, ContentType, ContentDisposition, Body: buffer, Expires: addDays(new Date(), 1) },
        (err) => {
          if (err)
            return reject(new BadRequestException(apiError('core.file.upload-failed', 'File upload failed', { error: String(err) })));
          resolve({ key, cdn: this.cdn(key) });
        },
      );
    });
  }

  download(key: string): Readable {
    if (!key.startsWith(this.folder) && !key.startsWith(this.tempFolder)) key = `${this.folder}/${key}`;
    return this.s3.getObject({ Bucket: this.bucket, Key: key }).createReadStream();
  }

  downloadByFolder(folder: string, key: string): Readable {
    return this.s3.getObject({ Bucket: this.bucket, Key: `${folder}/${key}` }).createReadStream();
  }

  private normalizeKeys(keyOrCdns: string[]): string[] {
    return keyOrCdns.filter((val) => val?.includes(`${this.folder}/`)).map((val) => `${this.folder}/${val.split(`${this.folder}/`).pop()}`);
  }

  async useFiles(keyOrCdns: string[], entity?: string, entityId?: string): Promise<void> {
    if (!Array.isArray(keyOrCdns)) return;
    await this.uploadedFileService.useFiles(this.normalizeKeys(keyOrCdns), entity, entityId);
  }

  async markUsed(ids: string[], meta?: UploadedFileMeta): Promise<void> {
    await this.uploadedFileService.markUsed(ids, meta);
  }

  async changeFiles(olds: string[], news: string[], entity?: string, entityId?: string): Promise<void> {
    if (Array.isArray(news)) await this.useFiles(news, entity, entityId);
    if (!Array.isArray(olds) || !Array.isArray(news)) return;
    const removed = olds.filter((v) => !isBlank(v)).filter((key) => !news.includes(key));
    const keys = this.normalizeKeys(removed);
    if (!keys.length) return;
    await new Promise<void>((resolve, reject) => {
      this.s3.deleteObjects({ Bucket: this.bucket, Delete: { Objects: ArrayUtilities.distinct(keys).map((Key) => ({ Key })) } }, (err) =>
        err ? reject(err) : resolve(),
      );
    })
      .then(() => this.uploadedFileService.delete(keys))
      .catch((err) => this.logger.warn(`changeFiles failed: ${String(err)}`));
  }
}
