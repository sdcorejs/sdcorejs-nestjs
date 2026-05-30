import type { Readable } from 'node:stream';

/** Runtime configuration for the file-storage module. */
export interface FileStorageConfig {
  /** `'s3'` when S3 creds are present, else `'local'`. Auto-detected from creds when omitted. */
  driver?: 's3' | 'local';
  accessId?: string;
  accessKey?: string;
  bucket?: string;
  /** Primary folder prefix for permanent files. Default `'core'`. */
  folder?: string;
  /** Base host for the local driver's public URLs (e.g. `https://api.example.com/`). */
  host?: string;
  /** Public CDN base URL used to build the returned `cdn` field for the S3 driver. */
  cdnBaseUrl?: string;
}
export const FILE_STORAGE_CONFIG = Symbol('FILE_STORAGE_CONFIG');

export interface UploadResult {
  fileName: string;
  fileSize: number;
  key: string;
  cdn: string;
}

/** Storage driver contract — same surface for S3 and local-disk implementations. */
export interface IFileStorageService {
  upload(buffer: Buffer, fileName?: string): Promise<UploadResult>;
  cloneFromUrl(url: string, fileName?: string): Promise<UploadResult>;
  uploadTemporary(buffer: Buffer, fileName?: string): Promise<{ key: string; cdn: string }>;
  download(key: string): Readable;
  downloadByFolder(folder: string, key: string): Readable;
  useFiles(keyOrCdns: string[], entity?: string, entityId?: string): Promise<void>;
  changeFiles(olds: string[], news: string[], entity?: string, entityId?: string): Promise<void>;
}
export const IFileStorageService = Symbol('IFileStorageService');
