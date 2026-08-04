import type { Readable } from 'node:stream';
import type { UploadedFilePublicAccessMode, UploadedFileVisibility } from './types';

export interface UploadedFileStorageWriteOptions {
  contentType: string;
  contentDisposition: string;
}

export type UploadedFileStorageSource = Buffer | Uint8Array | Readable;

export interface UploadedFileStorageUploadUrlRequest {
  key: string;
  contentType: string;
  size: number;
  expiresInSeconds: number;
  metadata: Readonly<Record<string, string>>;
  /** Optional provider-verified SHA-256 checksum value. */
  checksum?: string | null;
  /** Application upload endpoint used only by the local driver. */
  uploadUrl?: string;
}

export interface UploadedFileStorageUploadTarget {
  method: 'PUT' | 'POST';
  url: string;
  headers: Record<string, string>;
}

export interface UploadedFileStorageObjectMetadata {
  size: number;
  contentType: string | null;
  etag: string | null;
  checksum: string | null;
  metadata: Readonly<Record<string, string>>;
}

export interface UploadedFileStoragePromoteRequest {
  sourceKey: string;
  destinationKey: string;
  sourceEtag?: string | null;
  visibility?: UploadedFileVisibility;
  publicAccessMode?: UploadedFilePublicAccessMode;
}

export interface UploadedFileStorageDownloadUrlRequest {
  key: string;
  expiresInSeconds: number;
  contentType?: string;
  contentDisposition?: string;
  /** Protected application URL used only by the local driver. */
  downloadUrl?: string;
}

/** Internal byte-storage contract. Authorization and database writes live in UploadedFileService. */
export interface UploadedFileStorageDriver {
  readonly kind: 's3' | 'local';
  createUploadUrl(input: UploadedFileStorageUploadUrlRequest): Promise<UploadedFileStorageUploadTarget>;
  headObject(key: string): Promise<UploadedFileStorageObjectMetadata | null>;
  promoteObject(input: UploadedFileStoragePromoteRequest): Promise<void>;
  putObject(key: string, source: UploadedFileStorageSource, options: UploadedFileStorageWriteOptions): Promise<void>;
  deleteObject(key: string): Promise<void>;
  createDownloadUrl(input: UploadedFileStorageDownloadUrlRequest): Promise<string>;
  resolvePublicUrl(key: string): string;

  /** @deprecated Use putObject. */
  write(key: string, buffer: Buffer, options: UploadedFileStorageWriteOptions): Promise<void>;
  download(key: string): Promise<Readable>;
  /** @deprecated Use deleteObject for one key. */
  delete(keys: readonly string[]): Promise<void>;
  /** @deprecated Use resolvePublicUrl. */
  publicUrl(key: string): string;
}

export const UPLOADED_FILE_STORAGE_DRIVER = Symbol('UPLOADED_FILE_STORAGE_DRIVER');
