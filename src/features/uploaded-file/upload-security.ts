import { randomUUID } from 'node:crypto';
import { TextDecoder } from 'node:util';
import { slugify } from './utils';

export const DEFAULT_MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export const DEFAULT_ALLOWED_MIME_TYPES = [
  'application/json',
  'application/pdf',
  'application/zip',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/csv',
  'text/plain',
] as const;

const EXTENSION_MIME: Readonly<Record<string, string>> = {
  csv: 'text/csv',
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  json: 'application/json',
  pdf: 'application/pdf',
  png: 'image/png',
  txt: 'text/plain',
  webp: 'image/webp',
  zip: 'application/zip',
};

export class UploadedFileSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UploadedFileSecurityError';
  }
}

export interface ValidatedUpload {
  contentType: string;
  originalName: string;
}

export interface GeneratedStorageKey {
  id: string;
  key: string;
  originalName: string;
}

/** Removes paths/control characters while preserving a bounded display filename. */
export function sanitizeOriginalFileName(input?: string): string {
  const leaf = (input || 'TEMP').replace(/\\/g, '/').split('/').pop() ?? 'TEMP';
  const cleaned = Array.from(leaf)
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join('')
    .trim()
    .slice(0, 1024);
  return cleaned || 'TEMP';
}

/** Validates a configured object-key prefix without accepting path traversal. */
export function normalizeStoragePrefix(input?: string): string {
  const value = (input || 'core').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const parts = value.split('/');
  if (!value || parts.some((part) => !part || part === '.' || part === '..' || part.includes('\0'))) {
    throw new UploadedFileSecurityError('Invalid storage key prefix');
  }
  const normalizedParts = parts.map((part) => slugify(part));
  if (normalizedParts.some((part) => !part)) throw new UploadedFileSecurityError('Invalid storage key prefix');
  return normalizedParts.join('/');
}

/** Generates a server-owned UUID key; the original name is never the uniqueness primitive. */
export function buildStorageKey(prefix: string, tenantId: string, fileName?: string, namespace = 'tenant'): GeneratedStorageKey {
  const normalizedPrefix = normalizeStoragePrefix(prefix);
  const originalName = sanitizeOriginalFileName(fileName);
  const safeName = slugify(originalName).slice(0, 240) || 'file';
  const safeTenant = Buffer.from(tenantId, 'utf8').toString('base64url');
  if (!safeTenant) throw new UploadedFileSecurityError('Missing tenant storage namespace');
  const id = randomUUID();
  return { id, key: `${normalizedPrefix}/${namespace}/${safeTenant}/${id}/${safeName}`, originalName };
}

function startsWith(buffer: Buffer, signature: readonly number[]): boolean {
  return signature.every((byte, index) => buffer[index] === byte);
}

function detectStrongMime(buffer: Buffer): string | undefined {
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (buffer.subarray(0, 6).toString('ascii') === 'GIF87a' || buffer.subarray(0, 6).toString('ascii') === 'GIF89a') return 'image/gif';
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (buffer.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
  if (startsWith(buffer, [0x50, 0x4b, 0x03, 0x04]) || startsWith(buffer, [0x50, 0x4b, 0x05, 0x06])) return 'application/zip';
  return undefined;
}

function isValidUtf8Text(buffer: Buffer): boolean {
  if (buffer.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    return true;
  } catch {
    return false;
  }
}

function validatePracticalSignature(buffer: Buffer, mime: string): boolean {
  const strong = detectStrongMime(buffer);
  if (strong) return strong === mime;
  if (mime === 'application/json') {
    if (!isValidUtf8Text(buffer)) return false;
    try {
      JSON.parse(buffer.toString('utf8'));
      return true;
    } catch {
      return false;
    }
  }
  if (mime === 'text/plain' || mime === 'text/csv') return isValidUtf8Text(buffer);
  return false;
}

/** Enforces size, allowlist, extension/MIME agreement, and practical magic-byte validation. */
export function validateUploadBuffer(
  buffer: Buffer,
  fileName: string | undefined,
  declaredContentType: string | undefined,
  allowedMimeTypes: readonly string[],
  validateSignature: boolean,
  maxBytes = DEFAULT_MAX_UPLOAD_BYTES,
): ValidatedUpload {
  if (!Buffer.isBuffer(buffer)) throw new UploadedFileSecurityError('Invalid upload buffer');
  if (buffer.byteLength === 0) throw new UploadedFileSecurityError('Upload is empty');
  if (buffer.byteLength > maxBytes) throw new UploadedFileSecurityError('Upload exceeds the configured size limit');

  const originalName = sanitizeOriginalFileName(fileName);
  const extension = originalName.toLowerCase().split('.').pop() ?? '';
  const extensionMime = EXTENSION_MIME[extension];
  if (!extensionMime) throw new UploadedFileSecurityError('Upload extension is not supported');
  const declared = declaredContentType?.split(';', 1)[0]?.trim().toLowerCase();
  const detected = detectStrongMime(buffer);
  const contentType = declared || detected || extensionMime;
  if (!contentType) throw new UploadedFileSecurityError('Unable to determine upload MIME type');

  const allowed = new Set(allowedMimeTypes.map((mime) => mime.toLowerCase()));
  if (!allowed.has(contentType)) throw new UploadedFileSecurityError('Upload MIME type is not allowed');
  if (extensionMime && extensionMime !== contentType) throw new UploadedFileSecurityError('Upload extension and MIME type do not match');
  if (detected && detected !== contentType) throw new UploadedFileSecurityError('Upload signature and MIME type do not match');
  if (validateSignature && !validatePracticalSignature(buffer, contentType)) {
    throw new UploadedFileSecurityError('Upload signature validation failed');
  }

  return { contentType, originalName };
}

export function contentDisposition(fileName: string): string {
  const originalName = sanitizeOriginalFileName(fileName);
  const fallback = originalName.replace(/[^\x20-\x7e]|["\\]/g, '_');
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(originalName)}`;
}
