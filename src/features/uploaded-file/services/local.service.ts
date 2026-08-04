import { createReadStream, createWriteStream } from 'node:fs';
import { link, stat, unlink, writeFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Inject, Injectable } from '@nestjs/common';
import { type NormalizedUploadedFileConfig } from '../config';
import { SafeLocalPathResolver } from '../local-path';
import type {
  UploadedFileStorageDownloadUrlRequest,
  UploadedFileStorageDriver,
  UploadedFileStoragePromoteRequest,
  UploadedFileStorageSource,
  UploadedFileStorageUploadTarget,
  UploadedFileStorageUploadUrlRequest,
  UploadedFileStorageWriteOptions,
} from '../storage-driver';
import { UPLOADED_FILE_CONFIG } from '../types';

/** Internal local-disk driver. Every path crosses the same canonical containment boundary. */
@Injectable()
export class LocalUploadedFileStorage implements UploadedFileStorageDriver {
  readonly kind = 'local' as const;
  private readonly paths: SafeLocalPathResolver;

  constructor(@Inject(UPLOADED_FILE_CONFIG) private readonly config: NormalizedUploadedFileConfig) {
    this.paths = new SafeLocalPathResolver(config.localRoot);
  }

  async createUploadUrl(input: UploadedFileStorageUploadUrlRequest): Promise<UploadedFileStorageUploadTarget> {
    if (!input.uploadUrl) throw new Error('Local upload URL is required');
    // The local target is a raw byte transport. Using the declared file MIME here would let Nest's
    // JSON/urlencoded parsers consume and transform otherwise valid uploads before this controller.
    return {
      method: 'PUT',
      url: input.uploadUrl,
      headers: { 'content-length': String(input.size), 'content-type': 'application/octet-stream' },
    };
  }

  async putObject(key: string, source: UploadedFileStorageSource, _options: UploadedFileStorageWriteOptions): Promise<void> {
    const target = await this.paths.resolveForWrite(key);
    if (Buffer.isBuffer(source) || source instanceof Uint8Array) {
      await writeFile(target, Buffer.from(source), { flag: 'wx' });
      return;
    }
    await pipeline(source, createWriteStream(target, { flags: 'wx' }));
  }

  async write(key: string, buffer: Buffer, options: UploadedFileStorageWriteOptions): Promise<void> {
    await this.putObject(key, buffer, options);
  }

  async headObject(key: string) {
    try {
      const target = await this.paths.resolveExisting(key);
      const value = await stat(target);
      return { size: value.size, contentType: null, etag: null, checksum: null, metadata: {} };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async promoteObject(input: UploadedFileStoragePromoteRequest): Promise<void> {
    const source = await this.paths.resolveExisting(input.sourceKey);
    const destination = await this.paths.resolveForWrite(input.destinationKey);
    await link(source, destination);
    await unlink(source);
  }

  async download(key: string) {
    const target = await this.paths.resolveExisting(key);
    return createReadStream(target);
  }

  async delete(keys: readonly string[]): Promise<void> {
    await Promise.all(
      Array.from(new Set(keys)).map(async (key) => {
        try {
          const target = await this.paths.resolveExisting(key);
          await unlink(target);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      }),
    );
  }

  async deleteObject(key: string): Promise<void> {
    await this.delete([key]);
  }

  async createDownloadUrl(input: UploadedFileStorageDownloadUrlRequest): Promise<string> {
    if (!input.downloadUrl) throw new Error('Local download URL is required');
    return input.downloadUrl;
  }

  publicUrl(key: string): string {
    const base = this.config.host ? `${this.config.host.replace(/\/+$/, '')}/` : '';
    const encodedKey = key.split('/').map(encodeURIComponent).join('/');
    return `${base}file-storage/${encodedKey}`;
  }

  resolvePublicUrl(key: string): string {
    return this.publicUrl(key);
  }
}
