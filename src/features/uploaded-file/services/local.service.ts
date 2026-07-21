import { createReadStream } from 'node:fs';
import { unlink, writeFile } from 'node:fs/promises';
import { Inject, Injectable } from '@nestjs/common';
import { type NormalizedUploadedFileConfig } from '../config';
import { SafeLocalPathResolver } from '../local-path';
import type { UploadedFileStorageDriver, UploadedFileStorageWriteOptions } from '../storage-driver';
import { UPLOADED_FILE_CONFIG } from '../types';

/** Internal local-disk driver. Every path crosses the same canonical containment boundary. */
@Injectable()
export class LocalUploadedFileStorage implements UploadedFileStorageDriver {
  private readonly paths: SafeLocalPathResolver;

  constructor(@Inject(UPLOADED_FILE_CONFIG) private readonly config: NormalizedUploadedFileConfig) {
    this.paths = new SafeLocalPathResolver(config.localRoot);
  }

  async write(key: string, buffer: Buffer, _options: UploadedFileStorageWriteOptions): Promise<void> {
    const target = await this.paths.resolveForWrite(key);
    await writeFile(target, buffer, { flag: 'wx' });
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

  publicUrl(key: string): string {
    const base = this.config.host ? `${this.config.host.replace(/\/+$/, '')}/` : '';
    const encodedKey = key.split('/').map(encodeURIComponent).join('/');
    return `${base}file-storage/${encodedKey}`;
  }
}
