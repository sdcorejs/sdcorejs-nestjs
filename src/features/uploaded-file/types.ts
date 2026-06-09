import type { Readable } from 'node:stream';

/** Runtime configuration for the uploaded-file module. */
export interface UploadedFileConfig {
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
  /**
   * Days after which never-attached files (`isUsed = false`) are purged by a daily 03:00 cron.
   * Omit (or `<= 0`) to disable cleanup entirely — nothing is deleted. When set, the host MUST
   * import `@nestjs/schedule` `ScheduleModule.forRoot()` (the cron is a fixed `@Cron('0 3 * * *')`).
   * When the job-scheduler feature is also wired, each sweep is guarded by a distributed DB lock so
   * only one instance purges; otherwise it runs directly.
   */
  cleanupAfterDays?: number;
}
export const UPLOADED_FILE_CONFIG = Symbol('UPLOADED_FILE_CONFIG');

export interface UploadedFileResult {
  /** Persisted `uploaded_file` row id (UUID). */
  id: string;
  fileName: string;
  fileSize: number;
  key: string;
  cdn: string;
}

/** Optional provenance recorded on the persisted `uploaded_file` row. */
export interface UploadedFileMeta {
  module?: string;
  entity?: string;
  entityId?: string;
  type?: string;
}

/** Storage driver contract — same surface for S3 and local-disk implementations. */
export interface IUploadedFileStorage {
  upload(buffer: Buffer, fileName?: string, meta?: UploadedFileMeta): Promise<UploadedFileResult>;
  cloneFromUrl(url: string, fileName?: string): Promise<UploadedFileResult>;
  uploadTemporary(buffer: Buffer, fileName?: string): Promise<{ key: string; cdn: string }>;
  download(key: string): Readable;
  downloadByFolder(folder: string, key: string): Readable;
  useFiles(keyOrCdns: string[], entity?: string, entityId?: string): Promise<void>;
  changeFiles(olds: string[], news: string[], entity?: string, entityId?: string): Promise<void>;
  /** Mark the given `uploaded_file` rows used (by id), optionally stamping provenance. */
  markUsed(ids: string[], meta?: UploadedFileMeta): Promise<void>;
}
export const IUploadedFileStorage = Symbol('IUploadedFileStorage');
