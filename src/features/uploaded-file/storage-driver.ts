import type { Readable } from 'node:stream';

export interface UploadedFileStorageWriteOptions {
  contentType: string;
  contentDisposition: string;
}

/** Internal byte-storage contract. Authorization and database writes live in UploadedFileService. */
export interface UploadedFileStorageDriver {
  write(key: string, buffer: Buffer, options: UploadedFileStorageWriteOptions): Promise<void>;
  download(key: string): Promise<Readable>;
  delete(keys: readonly string[]): Promise<void>;
  publicUrl(key: string): string;
}

export const UPLOADED_FILE_STORAGE_DRIVER = Symbol('UPLOADED_FILE_STORAGE_DRIVER');
