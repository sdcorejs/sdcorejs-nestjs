import { resolve } from 'node:path';
import type { UploadedFileConfig } from './types';
import { DEFAULT_ALLOWED_MIME_TYPES, DEFAULT_MAX_UPLOAD_BYTES, normalizeStoragePrefix } from './upload-security';

export interface NormalizedUploadedFileConfig extends UploadedFileConfig {
  driver: 's3' | 'local';
  folder: string;
  localRoot: string;
  host: string;
  cdnBaseUrl: string;
  publicFiles: boolean;
  defaultVisibility: 'public' | 'private';
  allowPublicUploads: boolean;
  publicAccessMode: 'object-acl' | 'external';
  uploadUrlTtlSeconds: number;
  privateDownloadUrlTtlSeconds: number;
  maxPrivateDownloadUrlTtlSeconds: number;
  pendingCleanupInterval: string;
  temporaryCleanupInterval: string;
  cleanupBatchSize: number;
  downloadPath: string;
  maxFileSizeBytes: number;
  allowedMimeTypes: readonly string[];
  validateMagicBytes: boolean;
  remoteClone: NonNullable<UploadedFileConfig['remoteClone']>;
}

/** Absolute ceiling keeps every Buffer entry point bounded even if consumer config is unsafe. */
export const ABSOLUTE_MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const MAX_PRIVATE_DOWNLOAD_URL_TTL_SECONDS = 60 * 60;

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
  const resolved = value === undefined ? fallback : value;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new Error(`UploadedFileConfig.${name} must be a positive integer`);
  }
  return resolved;
}

function cronExpression(value: string | undefined, fallback: string, name: string): string {
  const resolved = value?.trim() || fallback;
  if (!resolved || resolved.length > 128 || resolved.split(/\s+/).length < 5) {
    throw new Error(`UploadedFileConfig.${name} must be a non-empty cron expression`);
  }
  return resolved;
}

export function normalizeUploadedFileConfig(config: UploadedFileConfig): NormalizedUploadedFileConfig {
  if (config.driver !== undefined && config.driver !== 's3' && config.driver !== 'local') {
    throw new Error("UploadedFileConfig.driver must be either 's3' or 'local'");
  }

  const hasAccessId = config.accessId !== undefined;
  const hasAccessKey = config.accessKey !== undefined;
  const accessId = typeof config.accessId === 'string' ? config.accessId.trim() : '';
  const accessKey = typeof config.accessKey === 'string' ? config.accessKey.trim() : '';
  if (hasAccessId !== hasAccessKey || (hasAccessId && (!accessId || !accessKey))) {
    throw new Error('UploadedFileConfig S3 credentials require both non-empty accessId and accessKey');
  }

  // Explicit local always wins, including when a complete S3 tuple is present for another
  // environment. Without an explicit driver, complete credentials opt into S3; the default AWS
  // credential chain remains an explicit `driver: 's3'` choice.
  const driver = config.driver ?? (hasAccessId ? 's3' : 'local');
  const bucket = typeof config.bucket === 'string' ? config.bucket.trim() : '';
  if (driver === 's3' && !bucket) {
    throw new Error('UploadedFileConfig.bucket must be a non-empty string when the S3 driver is selected');
  }

  const requestedLimit = Number.isFinite(config.maxFileSizeBytes) ? Math.floor(config.maxFileSizeBytes!) : DEFAULT_MAX_UPLOAD_BYTES;
  const maxFileSizeBytes = Math.max(1, Math.min(requestedLimit, ABSOLUTE_MAX_UPLOAD_BYTES));
  const allowedMimeTypes = Array.from(
    new Set(
      (config.allowedMimeTypes?.length ? config.allowedMimeTypes : DEFAULT_ALLOWED_MIME_TYPES).map((mime) => mime.trim().toLowerCase()),
    ),
  ).filter(Boolean);
  if (!allowedMimeTypes.length) throw new Error('UploadedFileConfig.allowedMimeTypes must not be empty');
  const configuredRemoteLimit = config.remoteClone?.maxBytes;
  const remoteLimit =
    typeof configuredRemoteLimit === 'number' && Number.isFinite(configuredRemoteLimit)
      ? Math.floor(configuredRemoteLimit)
      : maxFileSizeBytes;
  const legacyPublic = config.publicFiles === true;
  const defaultVisibility = config.defaultVisibility ?? (legacyPublic ? 'public' : 'private');
  if (defaultVisibility !== 'public' && defaultVisibility !== 'private') {
    throw new Error("UploadedFileConfig.defaultVisibility must be either 'public' or 'private'");
  }
  const allowPublicUploads = config.allowPublicUploads ?? legacyPublic;
  if (defaultVisibility === 'public' && allowPublicUploads !== true) {
    throw new Error('UploadedFileConfig.defaultVisibility public requires allowPublicUploads=true');
  }
  if (config.publicAccessMode !== undefined && config.publicAccessMode !== 'object-acl' && config.publicAccessMode !== 'external') {
    throw new Error("UploadedFileConfig.publicAccessMode must be either 'object-acl' or 'external'");
  }
  const maxPrivateDownloadUrlTtlSeconds = positiveInteger(
    config.maxPrivateDownloadUrlTtlSeconds,
    MAX_PRIVATE_DOWNLOAD_URL_TTL_SECONDS,
    'maxPrivateDownloadUrlTtlSeconds',
  );
  const privateDownloadUrlTtlSeconds = positiveInteger(config.privateDownloadUrlTtlSeconds, 15 * 60, 'privateDownloadUrlTtlSeconds');
  if (
    maxPrivateDownloadUrlTtlSeconds > MAX_PRIVATE_DOWNLOAD_URL_TTL_SECONDS ||
    privateDownloadUrlTtlSeconds > MAX_PRIVATE_DOWNLOAD_URL_TTL_SECONDS
  ) {
    throw new Error('UploadedFileConfig private signed URL TTL must not exceed one hour');
  }
  if (privateDownloadUrlTtlSeconds > maxPrivateDownloadUrlTtlSeconds) {
    throw new Error('UploadedFileConfig.privateDownloadUrlTtlSeconds must not exceed maxPrivateDownloadUrlTtlSeconds');
  }
  const uploadUrlTtlSeconds = positiveInteger(config.uploadUrlTtlSeconds, 10 * 60, 'uploadUrlTtlSeconds');
  if (uploadUrlTtlSeconds > 60 * 60) {
    throw new Error('UploadedFileConfig.uploadUrlTtlSeconds must not exceed one hour');
  }
  const cleanupBatchSize = positiveInteger(config.cleanupBatchSize, 100, 'cleanupBatchSize');
  if (cleanupBatchSize > 100) throw new Error('UploadedFileConfig.cleanupBatchSize must not exceed 100');
  return {
    ...config,
    driver,
    accessId: hasAccessId ? accessId : undefined,
    accessKey: hasAccessKey ? accessKey : undefined,
    bucket: bucket || undefined,
    region: config.region?.trim() || undefined,
    endpoint: config.endpoint?.trim().replace(/\/+$/, '') || undefined,
    forcePathStyle: config.forcePathStyle === true,
    folder: normalizeStoragePrefix(config.folder),
    localRoot: resolve(config.localRoot ?? resolve(process.cwd(), 'upload')),
    host: config.host ?? '',
    cdnBaseUrl: config.cdnBaseUrl ?? '',
    publicFiles: defaultVisibility === 'public',
    defaultVisibility,
    allowPublicUploads,
    publicAccessMode: config.publicAccessMode ?? 'external',
    uploadUrlTtlSeconds,
    privateDownloadUrlTtlSeconds,
    maxPrivateDownloadUrlTtlSeconds,
    pendingCleanupInterval: cronExpression(config.pendingCleanupInterval, '0 3 * * *', 'pendingCleanupInterval'),
    temporaryCleanupInterval: cronExpression(config.temporaryCleanupInterval, '*/15 * * * *', 'temporaryCleanupInterval'),
    cleanupBatchSize,
    downloadPath: normalizeStoragePrefix(config.downloadPath ?? 'uploaded-file'),
    maxFileSizeBytes,
    allowedMimeTypes,
    validateMagicBytes: config.validateMagicBytes !== false,
    remoteClone: {
      enabled: config.remoteClone?.enabled === true,
      timeoutMs: config.remoteClone?.timeoutMs,
      maxBytes: Math.max(1, Math.min(remoteLimit, maxFileSizeBytes)),
      maxRedirects: config.remoteClone?.maxRedirects,
      allowedHosts: config.remoteClone?.allowedHosts,
    },
  };
}
