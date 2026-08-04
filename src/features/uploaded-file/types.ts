import type { RequestContext } from '../../core/context/types';
import type { RemoteCloneOptions } from './remote-fetcher';

/** Per-file read exposure. Private is the secure default. */
export type UploadedFileVisibility = 'public' | 'private';

/** Persisted direct-upload lifecycle state. */
export type UploadedFileStatus = 'pending' | 'completing' | 'ready' | 'failed';

/** Browser rendering/download preference persisted with the file. */
export type UploadedFileDisposition = 'inline' | 'attachment';

/** How a public object becomes readable at its origin. */
export type UploadedFilePublicAccessMode = 'object-acl' | 'external';

/** Authorized operation evaluated by the uploaded-file policy. */
export type UploadedFileOperation = 'create' | 'read' | 'update' | 'mark-used' | 'delete' | 'clone' | 'complete' | 'abort';

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
export type UploadedFileAttachedReadPolicy = (request: UploadedFileAttachedReadRequest) => boolean | Promise<boolean>;

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
  /** Optional S3-compatible origin endpoint, for example a DigitalOcean Spaces endpoint. */
  endpoint?: string;
  /** Force path-style addressing for S3-compatible providers that require it. */
  forcePathStyle?: boolean;
  /** Required and non-blank whenever the resolved driver is S3. */
  bucket?: string;
  /** Primary object-key prefix. Default `'core'`; traversal components are rejected at startup. */
  folder?: string;
  /** Absolute or relative local storage root. Default `<cwd>/upload`; canonicalized before use. */
  localRoot?: string;
  /** Base host for authenticated download URLs. */
  host?: string;
  /** Stable public read base. It never replaces the S3/Spaces origin used for signed PUT. */
  cdnBaseUrl?: string;
  /** Explicit opt-in for unauthenticated/public object URLs. Default `false`. */
  publicFiles?: boolean;
  /** Visibility used by legacy/internal uploads when no per-call visibility is supplied. */
  defaultVisibility?: UploadedFileVisibility;
  /** Required opt-in before an internal caller may create a public file. */
  allowPublicUploads?: boolean;
  /** Public origin policy. `external` is compatible with ACL-disabled S3 buckets. */
  publicAccessMode?: UploadedFilePublicAccessMode;
  /** Lifetime of one direct-upload target. Default 10 minutes. */
  uploadUrlTtlSeconds?: number;
  /** Lifetime of one private S3/Spaces preview URL. Default 15 minutes. */
  privateDownloadUrlTtlSeconds?: number;
  /** Absolute private preview URL ceiling. Must not exceed one hour. */
  maxPrivateDownloadUrlTtlSeconds?: number;
  /** Cron expression used to retry pending upload/deletion work. */
  pendingCleanupInterval?: string;
  /** Cron expression used to remove expired temporary files. */
  temporaryCleanupInterval?: string;
  /** Maximum rows claimed by one cleanup batch. */
  cleanupBatchSize?: number;
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
   * Days after which never-attached legacy files (`isUsed = false`) are purged by pending cleanup.
   * Omit (or `<= 0`) to disable age-based purging. Durable pending deletions are still retried.
   * The legacy three-argument `uploadTemporary` overload still requires this value for source
   * compatibility, but every newly completed temporary file uses the non-configurable 24-hour
   * completion lifetime and is excluded from this age purge.
   */
  cleanupAfterDays?: number;
}

export interface UploadedFileResult {
  /** Persisted `uploaded_file` row id (UUID). */
  id: string;
  /** Legacy display-name field. */
  fileName: string;
  /** Canonical display-name alias for new consumers. */
  originalName: string;
  /** Legacy rounded-MiB field. */
  fileSize: number;
  /** Exact byte count for direct uploads. */
  size: number;
  /** @deprecated Internal storage reference retained for service-level compatibility. */
  key: string;
  /** @deprecated Legacy URL/reference retained for service-level compatibility. */
  cdn: string;
  contentType: string;
  visibility: UploadedFileVisibility;
  status: UploadedFileStatus;
  isTemporary: boolean;
  completedAt: Date | null;
  expiredAt: Date | null;
  disposition: UploadedFileDisposition;
  /** Immediately usable preview URL. Never persisted when it is signed. */
  url: string | null;
  /** Null for stable public/protected-local URLs. */
  urlExpiredAt: Date | null;
}

/** Safe HTTP projection: storage keys and the legacy persisted URL are never serialized. */
export type UploadedFileHttpResult = Omit<UploadedFileResult, 'key' | 'cdn'>;

/** Optional provenance recorded on the persisted `uploaded_file` row. */
export interface UploadedFileMeta {
  module?: string;
  entity?: string;
  entityId?: string;
  type?: string;
}

/** Domain ownership/provenance supplied by an internal caller. */
export type UploadedFileContext = UploadedFileMeta;

/** Optional server-validated attributes for one upload. */
export interface UploadedFileUploadOptions {
  /** Untrusted client-declared MIME; validated against allowlist, extension, and signature. */
  contentType?: string;
  /** Optional caller narrowing; intersected with the module allowlist and never widens it. */
  allowedMimeTypes?: readonly string[];
  /** Optional caller narrowing; clamped to the configured service limit and never widens it. */
  maxFileSizeBytes?: number;
  /** Exact source byte count. Required for a Readable source. */
  size?: number;
  /** Requested internal visibility. Public requires module opt-in. */
  visibility?: UploadedFileVisibility;
  /** Preview/download content disposition. */
  disposition?: UploadedFileDisposition;
}

/** Temporary uploads cannot request visibility or caller-controlled expiry. */
export type UploadedFileTemporaryUploadOptions = Omit<UploadedFileUploadOptions, 'visibility'> & {
  visibility?: never;
  expiredAt?: never;
  ttlSeconds?: never;
};

/** Metadata accepted before any direct-upload bytes exist. */
export interface InitiateUploadedFileInput {
  originalName: string;
  contentType: string;
  size: number;
  checksum?: string;
}

/** Provider-neutral one-object upload instructions. */
export interface InitiateUploadedFileResult {
  id: string;
  status: 'pending';
  upload: {
    method: 'PUT' | 'POST';
    url: string;
    headers: Record<string, string>;
    expiredAt: Date;
  };
}

/** Maximum number of IDs or storage references accepted by one public batch operation. */
export const UPLOADED_FILE_BATCH_LIMIT = 100;

/** Maximum length of one exact storage key/private URL reference accepted by batch operations. */
export const UPLOADED_FILE_REFERENCE_MAX_LENGTH = 1024;

/** SSRF-hardened, bounded configuration for explicitly enabled remote cloning. */
export type UploadedFileRemoteCloneConfig = RemoteCloneOptions;

/** DI token for the resolved {@link UploadedFileConfig}. */
export const UPLOADED_FILE_CONFIG = Symbol('UPLOADED_FILE_CONFIG');
