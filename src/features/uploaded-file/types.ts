import type { RequestContext } from '../../core/context/types';
import type { RemoteCloneOptions } from './remote-fetcher';

/** Authorized operation evaluated by the uploaded-file policy. */
export type UploadedFileOperation = 'create' | 'read' | 'update' | 'mark-used' | 'delete' | 'clone';

/** Bounded policy result; mandatory tenant/department predicates always remain in force. */
export type UploadedFileAccessDecision = 'owner' | 'tenant' | 'deny';

/** Trusted tenant, optional department, and owner dimensions for an uploaded-file request. */
export interface UploadedFileScope {
  /** Mandatory tenant boundary. */
  tenantCode: string;
  /** Optional narrower tenant boundary. */
  departmentCode?: string;
  /** Mandatory owning user. */
  userId: string;
}

/** Input supplied to the consumer authorization policy after scope normalization. */
export interface UploadedFileAuthorizationRequest {
  /** Requested service operation. */
  operation: UploadedFileOperation;
  /** Current trusted request context. */
  context: Readonly<RequestContext>;
  /** Trusted tenant/department/owner scope. */
  scope: Readonly<UploadedFileScope>;
  /** Exact row ids involved in the request, bounded by the public batch limit. */
  resourceIds: readonly string[];
  /** Exact storage references involved in the request, bounded by the public batch limit. */
  storageReferences: readonly string[];
}

/**
 * Query-safe sharing policy. It returns only a bounded access level; mandatory tenant/department
 * predicates are always added by the library and cannot be replaced with raw SQL.
 */
export type UploadedFileAuthorizationPolicy = (
  request: UploadedFileAuthorizationRequest,
) => UploadedFileAccessDecision | Promise<UploadedFileAccessDecision>;

/** Exact domain ownership metadata required for a policy-approved attached-file read. */
export interface UploadedFileAttachment {
  module: string;
  entity: string;
  entityId: string;
}

/** Trusted context supplied to the optional attached-file authorization policy. */
export interface UploadedFileAttachedReadRequest {
  context: Readonly<RequestContext>;
  scope: Readonly<UploadedFileScope>;
  resourceId: string;
  attachment: Readonly<UploadedFileAttachment>;
}

/** Deny-by-default policy for exact attached-file reads across uploader identity. */
export type UploadedFileAttachedReadPolicy = (
  request: UploadedFileAttachedReadRequest,
) => boolean | Promise<boolean>;

/** Runtime configuration for the uploaded-file module. Secure defaults are applied by the module. */
export interface UploadedFileConfig {
  /** Auto-detects S3 from a complete explicit credential pair; set `'s3'` to use the AWS default credential chain. */
  driver?: 's3' | 'local';
  /** Optional explicit AWS access-key id. Must be supplied together with `accessKey`. */
  accessId?: string;
  /** Optional explicit AWS secret access key. Must be supplied together with `accessId`. */
  accessKey?: string;
  /** Optional AWS region. Omit to use the AWS SDK v3 default region provider chain. */
  region?: string;
  /** Required and non-blank whenever the resolved driver is S3. */
  bucket?: string;
  /** Primary object-key prefix. Default `'core'`; traversal components are rejected at startup. */
  folder?: string;
  /** Absolute or relative local storage root. Default `<cwd>/upload`; canonicalized before use. */
  localRoot?: string;
  /** Base host for authenticated download URLs. */
  host?: string;
  /** Public CDN base URL. Used only when `publicFiles` is explicitly enabled. */
  cdnBaseUrl?: string;
  /** Explicit opt-in for unauthenticated/public object URLs. Default `false`. */
  publicFiles?: boolean;
  /** Route segment appended to `host` for private downloads. Default `uploaded-file`. */
  downloadPath?: string;
  /** Hard service-level size limit. Values above the library ceiling are clamped. */
  maxFileSizeBytes?: number;
  /** Server-side MIME allowlist. Defaults to common image/document formats. */
  allowedMimeTypes?: readonly string[];
  /** Practical magic-byte/UTF-8 validation. Default `true`. */
  validateMagicBytes?: boolean;
  /** Remote cloning is disabled unless `enabled: true`; every hop is independently validated. */
  remoteClone?: RemoteCloneOptions;
  /** Optional trusted mapping from request context to file tenant/owner scope. */
  resolveScope?: (context: Readonly<RequestContext>) => Partial<UploadedFileScope>;
  /** Defaults to owner-only. A policy may grant same-scope tenant access but never cross-tenant access. */
  authorizationPolicy?: UploadedFileAuthorizationPolicy;
  /** Optional fail-closed policy for exact used-file attachment reads. Omission denies the operation. */
  attachedReadPolicy?: UploadedFileAttachedReadPolicy;
  /**
   * Days after which never-attached files (`isUsed = false`) are purged by a daily 03:00 cron.
   * Omit (or `<= 0`) to disable age-based purging. Durable pending deletions are still retried.
   * Temporary uploads require a positive finite value so they always have a tracked lifecycle.
   */
  cleanupAfterDays?: number;
}

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

/** Optional server-validated attributes for one upload. */
export interface UploadedFileUploadOptions {
  /** Untrusted client-declared MIME; validated against allowlist, extension, and signature. */
  contentType?: string;
  /** Optional caller narrowing; intersected with the module allowlist and never widens it. */
  allowedMimeTypes?: readonly string[];
  /** Optional caller narrowing; clamped to the configured service limit and never widens it. */
  maxFileSizeBytes?: number;
}

/** Maximum number of IDs or storage references accepted by one public batch operation. */
export const UPLOADED_FILE_BATCH_LIMIT = 100;

/** Maximum length of one exact storage key/private URL reference accepted by batch operations. */
export const UPLOADED_FILE_REFERENCE_MAX_LENGTH = 1024;

/** SSRF-hardened, bounded configuration for explicitly enabled remote cloning. */
export type UploadedFileRemoteCloneConfig = RemoteCloneOptions;

/** DI token for the resolved {@link UploadedFileConfig}. */
export const UPLOADED_FILE_CONFIG = Symbol('UPLOADED_FILE_CONFIG');
