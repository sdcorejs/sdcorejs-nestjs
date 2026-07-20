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
  downloadPath: string;
  maxFileSizeBytes: number;
  allowedMimeTypes: readonly string[];
  validateMagicBytes: boolean;
  remoteClone: NonNullable<UploadedFileConfig['remoteClone']>;
}

/** Absolute ceiling keeps every Buffer entry point bounded even if consumer config is unsafe. */
export const ABSOLUTE_MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

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
  return {
    ...config,
    driver,
    accessId: hasAccessId ? accessId : undefined,
    accessKey: hasAccessKey ? accessKey : undefined,
    bucket: bucket || undefined,
    region: config.region?.trim() || undefined,
    folder: normalizeStoragePrefix(config.folder),
    localRoot: resolve(config.localRoot ?? resolve(process.cwd(), 'upload')),
    host: config.host ?? '',
    cdnBaseUrl: config.cdnBaseUrl ?? '',
    publicFiles: config.publicFiles === true,
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
