# Uploaded files API

Import path: `@sdcorejs/nestjs/features`

The uploaded-file feature stores metadata in PostgreSQL and bytes on local disk or S3. Every normal
operation resolves a trusted tenant/owner scope, applies an authorization policy and uses
non-enumerating failures for invalid, missing, denied and cross-scope resources.

## Exports

| Export                               | Kind         | Purpose                                                      |
| ------------------------------------ | ------------ | ------------------------------------------------------------ |
| `UploadedFile<TExtraData>`           | entity class | metadata plus durable upload/deletion state                  |
| `UploadedFileService`                | class        | Authorized upload, lookup, download, attach and deletion API |
| `UploadedFileModule`                 | class        | Global feature module; `forRoot(config)`                     |
| `UploadedFileController`             | class        | Optional authenticated upload/download HTTP surface          |
| `UploadedFileConfig`                 | interface    | Driver, validation, scope, authorization and cleanup config  |
| `UploadedFileContext`                | type         | Trusted request context accepted by service operations       |
| `UploadedFileOperation`              | type         | includes `create`, `read`, `complete`, `abort`, and legacy operations |
| `UploadedFileAccessDecision`         | type         | `'owner' \| 'tenant' \| 'deny'`                              |
| `UploadedFileScope`                  | interface    | Tenant, optional department and owner IDs                    |
| `UploadedFileAuthorizationRequest`   | interface    | Policy input with trusted context and bounded resources      |
| `UploadedFileAuthorizationPolicy`    | type         | Async/sync bounded decision callback                         |
| `UploadedFileAttachment`             | interface    | Exact module/entity/entityId attachment ownership            |
| `UploadedFileAttachedReadRequest`    | interface    | Trusted scope and attachment input for attached reads        |
| `UploadedFileAttachedReadPolicy`     | type         | Deny-by-default exact attachment read callback               |
| `UploadedFileMeta`                   | interface    | Optional module/entity/entityId/type provenance              |
| `UploadedFileUploadOptions`          | interface    | Optional declared MIME and per-call validation narrowing     |
| `UploadedFileTemporaryUploadOptions` | type         | Managed temporary options; visibility/TTL are forbidden      |
| `InitiateUploadedFileInput`          | interface    | Original name, declared content type, exact size, checksum    |
| `InitiateUploadedFileResult`         | interface    | Provider-neutral one-object upload instructions               |
| `UploadedFileResult`                 | interface    | URL-aware service result; legacy key/CDN fields retained internally |
| `UploadedFileHttpResult`             | type         | HTTP-safe result with `key` and persisted `cdn` removed       |
| `UploadedFileVisibility`             | type         | `'public' \| 'private'`                                      |
| `UploadedFilePublicAccessMode`       | type         | `'object-acl' \| 'external'` public object policy            |
| `UploadedFileStatus`                 | type         | `'pending' \| 'completing' \| 'ready' \| 'failed'`          |
| `UploadedFileDisposition`            | type         | `'inline' \| 'attachment'`                                   |
| `UploadedFileDirectLifecycle1785744000000` | migration class | Additive PostgreSQL lifecycle migration                |
| `UploadedFileRemoteCloneConfig`      | type         | Enabled/timeout/size/redirect/host controls                  |
| `UPLOADED_FILE_BATCH_LIMIT`          | value        | `100` IDs/references per public batch                        |
| `UPLOADED_FILE_REFERENCE_MAX_LENGTH` | value        | `1024` characters per exact reference                        |
| `UPLOADED_FILE_CONFIG`               | value        | Resolved feature config DI token                             |

Raw storage drivers, storage-key helpers and maintenance providers are intentionally not exported,
so application code cannot bypass service authorization with arbitrary object keys.

## Entity registration and module setup

```ts
TypeOrmModule.forRoot({
  type: 'postgres',
  // ...
  entities: [UploadedFile],
});

UploadedFileModule.forRoot({
  driver: 'local',
  localRoot: './var/uploads',
  host: 'https://api.example.com',
  cleanupAfterDays: 7,
  resolveScope: (ctx) => ({
    tenantCode: ctx.tenant,
    departmentCode: typeof ctx.custom?.departmentCode === 'string' ? ctx.custom.departmentCode : undefined,
    userId: ctx.userId,
  }),
  authorizationPolicy: ({ operation, context }) => {
    if (operation === 'read' && context.roles?.includes('tenant-file-reader')) return 'tenant';
    return 'owner';
  },
  attachedReadPolicy: ({ context, attachment }) =>
    attachment.module === 'cms' &&
    attachment.entity === 'asset' &&
    context.permissions?.includes('cms.asset.view'),
});
```

Add `UploadedFile` to the datasource. The entity uses UUID, `jsonb`, `timestamptz` and soft-delete
columns and has unique `key`/`cdn` values. Direct lifecycle adds exact `sizeBytes`, `contentType`,
`pendingKey`, `visibility`, `status`, `isTemporary`, upload/completion/expiry timestamps,
`disposition`, `checksum`, and `etag`, plus pending/temporary/owner-status indexes.

## Configuration

| Option                  | Default / constraint                                                                                                          |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `driver`                | Local unless a complete explicit `accessId` + `accessKey` pair auto-selects S3; explicit `'s3'` uses the AWS credential chain |
| `accessId`, `accessKey` | Optional but must be supplied together and nonblank                                                                           |
| `region`                | AWS SDK provider chain when omitted                                                                                           |
| `endpoint`              | Optional S3-compatible origin, for example a Spaces endpoint                                                                 |
| `forcePathStyle`        | `false`; used with compatible origins that require path-style addressing                                                      |
| `bucket`                | Required and nonblank for S3                                                                                                  |
| `folder`                | `'core'`; normalized, traversal segments rejected                                                                             |
| `localRoot`             | `<cwd>/upload`; canonical absolute path                                                                                       |
| `host`                  | Empty; base for authenticated private URLs                                                                                    |
| `cdnBaseUrl`            | Empty; stable public read base only, never the presigned PUT origin                                                           |
| `defaultVisibility`     | `'private'`; managed internal upload default                                                                                  |
| `allowPublicUploads`    | `false`; required before internal callers can request public                                                                 |
| `publicAccessMode`      | `'external'`; `'object-acl'` sends `public-read`, external sends no ACL                                                       |
| `publicFiles`           | Deprecated compatibility input; `true` normalizes permanent defaults/opt-in, never temporary                                 |
| `uploadUrlTtlSeconds`   | `600`; positive integer, at most one hour                                                                                     |
| `privateDownloadUrlTtlSeconds` | `900`; positive integer, never above the configured/absolute one-hour maximum                                         |
| `maxPrivateDownloadUrlTtlSeconds` | `3600`; cannot exceed one hour                                                                                       |
| `pendingCleanupInterval` | `'0 3 * * *'`; direct pending/staging/outbox/legacy age sweep                                                               |
| `temporaryCleanupInterval` | `'*/15 * * * *'`; ready temporary expiry sweep                                                                            |
| `cleanupBatchSize`      | `100`; positive integer capped at 100                                                                                         |
| `downloadPath`          | `'uploaded-file'`                                                                                                             |
| `maxFileSizeBytes`      | 10 MiB default; clamped to the absolute 25 MiB ceiling                                                                        |
| `allowedMimeTypes`      | JSON, PDF, ZIP, DOCX, XLSX, PPTX, GIF, JPEG, PNG, WebP, CSV and plain text                                                    |
| `validateMagicBytes`    | `true`                                                                                                                        |
| `remoteClone`           | Disabled; defaults 5s, at most service size, 3 redirects (absolute max 5)                                                     |
| `resolveScope`          | Falls back to `ctx.tenant`, `ctx.userId`, then matching `ctx.custom` fields                                                   |
| `authorizationPolicy`   | Owner-only when absent                                                                                                        |
| `attachedReadPolicy`    | Attached reads denied when absent; only exact `true` approves                                                                 |
| `cleanupAfterDays`      | Legacy unused-row age purge only; does not control the fixed 24-hour temporary lifetime                                       |

Remote `allowedHosts` is an optional exact hostname allowlist. When cloning is enabled, every URL
and redirect is revalidated, DNS must resolve to public addresses, the connection is pinned to a
validated address, response size is bounded, and downloaded bytes still pass ordinary upload
validation.

## Authorization policy

```ts
type UploadedFileAccessDecision = 'owner' | 'tenant' | 'deny';
```

The service always adds `tenantCode`; when scope contains `departmentCode`, it also adds that
predicate. An `owner` decision additionally adds `userId`; `tenant` removes only the owner
predicate and cannot remove tenant/department boundaries. Policy exceptions and unknown decisions
become deny.

The policy receives validated resource UUIDs and exact storage references, never raw SQL. IDs and
references are bounded before the callback runs.

## Service methods

| Member                              | Signature / result                                                                         |
| ----------------------------------- | ------------------------------------------------------------------------------------------ |
| `getContent`                        | `(fileName?) => { ContentType?, ContentDisposition? }`; pure allowlisted extension mapping |
| `upload<T>` legacy                  | `(buffer, fileName?, meta?, extraData?, options?) => Promise<UploadedFile<T>>`             |
| `upload` managed                    | `(source, originalName, context?, ownerId?, options?) => Promise<UploadedFileResult>`       |
| `uploadTemporary` legacy            | `(buffer, fileName?, options?) => Promise<{ key, cdn }>`                                   |
| `uploadTemporary` managed           | `(source, originalName, context?, ownerId?, options?) => Promise<UploadedFileResult>`       |
| `initiateUpload` / `initiateTemporaryUpload` | `(input) => Promise<InitiateUploadedFileResult>`                                    |
| `completeUpload` / `abortUpload`    | `(id) => Promise<UploadedFileResult \| void>`                                              |
| `resolveUrl`                        | `(id) => Promise<{ url, urlExpiredAt }>`                                                   |
| `find`                              | `(id) => Promise<UploadedFileResult>`                                                      |
| `deleteById`                        | `(id) => Promise<void>`; abort pending or delete ready with durable cleanup                |
| `putUploadContent`                  | `(id, buffer) => Promise<UploadedFileResult>`; local authenticated target only             |
| `cloneFromUrl<T>`                   | `(url, fileName?, meta?, extraData?) => Promise<UploadedFile<T>>`                          |
| `download`                          | `(id) => Promise<{ stream, fileName }>`                                                    |
| `downloadAttached`                  | `(id, attachment) => Promise<{ stream, fileName }>`; exact policy-approved attachment read |
| `findById<T>`                       | `(id) => Promise<UploadedFile<T>>`                                                         |
| `setExtraData<T>`                   | `(id, extraData: Partial<T>) => Promise<void>`                                             |
| `markUsed`                          | `(ids, meta?, manager?) => Promise<void>`; optional caller-owned transaction               |
| `useFiles`                          | `(references, entity?, entityId?) => Promise<void>`                                        |
| `delete`                            | `(references) => Promise<void>`; durable object deletion                                   |
| `changeFiles`                       | `(olds, news, entity?, entityId?) => Promise<void>`                                        |
| `unsafeSystemRetryPendingDeletions` | `(limit = 100) => Promise<number>`; cross-tenant maintenance only                          |
| `unsafeSystemRetireUploadTombstone` | `(id) => Promise<boolean>`; operator-confirmed abandoned upload only                       |
| `unsafeSystemPurgeUnusedBefore`     | `(cutoff) => Promise<number>`; cross-tenant maintenance only                               |
| `cleanupPendingUploads`             | `(limit?) => Promise<number>`; direct pending/staging and deletion retry sweep              |
| `cleanupExpiredTemporaryFiles`      | `(now?, limit?) => Promise<number>`; exact-expiry CAS cleanup                              |
| `unsafeSystemCleanupCompletedStaging` | `(limit?) => Promise<number>`; retained S3 staging cleanup                               |

```ts
const file = await uploads.upload(
  buffer,
  'invoice.pdf',
  { module: 'billing', entity: 'invoice', entityId: invoiceId, type: 'attachment' },
  { checksum: sha256 },
  { contentType: 'application/pdf' },
);

await uploads.markUsed([file.id], {
  module: 'billing',
  entity: 'invoice',
  entityId: invoiceId,
  type: 'attachment',
});
```

`module`, `entity`, `entityId`, and `type` are provenance only; they are not a domain-resource
authorization decision. Before calling `markUsed`, `useFiles`, or `changeFiles`, the host must load
and authorize the target domain resource in its own tenant/permission model. Built-in lookups by
`entityId` do not independently authorize that target resource.

The upload path validates non-empty bounded buffers, sanitized names, MIME allowlist,
extension/content agreement and practical signatures/UTF-8 when enabled. Storage keys contain a
server UUID and encoded tenant namespace; the caller's filename is not the uniqueness boundary.
An upload call may narrow `allowedMimeTypes` and `maxFileSizeBytes`; those values are intersected
with or clamped to module configuration and cannot widen it.

DOCX, XLSX and PPTX additionally receive bounded structural ZIP inspection: at most 2,048 entries,
100 MiB total declared uncompressed data, 50 MiB per entry and a 100:1 per-entry compression ratio.
Encrypted, ZIP64/multi-disk, unsafe or duplicate paths, malformed directory offsets and packages
missing `[Content_Types].xml` or their expected main part are rejected. This validation is not
malware scanning.

When a consumer supplies an `EntityManager`, `markUsed` verifies and updates through it without
opening a nested transaction; otherwise it opens one library-owned transaction. `downloadAttached`
first requires `attachedReadPolicy` to return exactly `true`, then enforces trusted tenant scope and
exact active, used attachment metadata. UUIDv7 domain `entityId` values are supported. The original
uploader is intentionally not part of this exact attachment lookup.

## Durable pending lifecycle

Direct initiate persists `status: 'pending'`, a private staging key, distinct generated final key,
exact expected size/content type, upload expiry, and an in-flight cleanup lease before returning the
target. Completion verifies the staging version, CAS-claims `pending → completing`, promotes without
downloading through the backend, verifies final metadata, then CAS-finalizes `ready`. A completion
lease prevents two instances from promoting independently; an expired lease can be recovered. S3
staging remains retryable until a later idempotent cleanup, while local promotion uses a no-overwrite
hard-link/move and clears `pendingKey`.

Public ready files resolve to a stable URL with null expiry. Private S3/Spaces files use a fresh
presigned GET capped at one hour; the signed URL is neither persisted nor logged. A new temporary
file is always private, and successful completion writes `expiredAt = completedAt + 24 elapsed hours`.
Read/detail refuses it at `now >= expiredAt` independently of cleanup and clamps the final signed URL
to that boundary.

An upload is persisted first as a hidden row whose `uploadPendingAt` is a future 15-minute
activation lease; `deletionPendingAt` remains null. After writing bytes, activation uses
compare-and-swap (CAS): it clears only that exact upload marker while the deletion marker is still
null. Normal reads and mutations require both pending fields to be null, so in-flight and failed rows
are invisible.

If the write or activation fails, settled cleanup atomically clears the exact upload marker and sets
a fresh, future-dated deletion claim before touching storage. A late activation still expecting the
original marker therefore affects zero rows and cannot resurrect metadata while bytes are being
deleted. If activation actually committed but its response was lost, the active-row confirmation
prevents cleanup. If maintenance reached an expired upload while its storage write was still slow,
the writer later CAS-settles the exact current state—atomically restoring a soft-deleted row to
hidden pending state when necessary—before deleting the generated key. The durable deletion claim
therefore exists before terminal storage I/O. A storage or finalization failure CAS-releases the
owned claim to a one-minute future retry marker. This backoff prevents a full batch of repeatedly
failing objects from monopolizing every bounded sweep; abandoned claims become eligible when their
lease or retry delay expires.

`delete()` similarly claims rows as pending before deleting bytes and soft-deleting metadata.
`unsafeSystemRetryPendingDeletions()` prioritizes settled deletion claims, then uses remaining batch
capacity for expired upload tombstones. It CAS-claims the exact upload marker, deletion marker and
soft-delete state before storage I/O. A stale worker that lost that CAS skips deletion. A successful
settled deletion clears its claim. An unresolved upload keeps both its `uploadPendingAt` tombstone
and a future deletion claim after soft deletion, so producer-process death cannot erase the retry
signal; later sweeps restore, delete and reschedule it. The cron drains up to ten 100-row batches per
run. Failed rows move out of the eligible window before the next query, so later rows can advance
through the bounded queue.

An unresolved tombstone is intentionally durable until the writer settles. After stopping and
draining all producer processes and verifying that the generated object cannot still be written, an
operator may call `unsafeSystemRetireUploadTombstone(id)`. It atomically converts the exact expired
tombstone into ordinary elapsed deletion-retry state and refuses to retire a live upload lease or
steal a live deletion lease.

`UploadedFileModule` registers configurable pending and temporary cron tracks. Import
`ScheduleModule.forRoot()` in the host to activate them. Pending/staging/deletion work is retried even
when `cleanupAfterDays` is disabled; age-based purge of unused legacy rows runs only with positive
retention. Temporary expiry is always 24 hours and uses its own interval. When `JobSchedulerService`
is available, each cron uses a distributed lock; row CAS/outbox handling also protects concurrent
instances.

::: warning Unsafe maintenance API
All `unsafeSystem*` methods intentionally bypass request tenant/owner policy across all tenants.
Invoke them only from trusted background maintenance code; never expose them directly in an HTTP
controller.
:::

## Optional controller

`UploadedFileController` is not auto-registered. Add it to an application module's `controllers`:

| Route                                      | Behavior                                                                      |
| ------------------------------------------ | ----------------------------------------------------------------------------- |
| `POST /uploaded-file/initiate`             | Private pending metadata and provider-neutral direct target                   |
| `POST /uploaded-file/temporary/initiate`   | Private temporary direct target; no TTL/visibility input                      |
| `POST /uploaded-file/:id/complete`         | Verify/promote/finalize; empty body                                            |
| `PUT /uploaded-file/:id/content`           | Local-driver raw binary target                                                 |
| `GET /uploaded-file/:id`                   | Authorized URL-aware detail                                                    |
| `DELETE /uploaded-file/:id`                | Abort pending or delete ready                                                  |
| `POST /uploaded-file`                      | Deprecated multipart compatibility route                                      |
| `GET /uploaded-file/:id/download`          | Compatibility stream with allowlisted type, `nosniff`, attachment disposition |

All routes use `AuthGuard`; service policy still enforces tenant/owner access. Direct HTTP responses
never serialize storage keys or persisted private/CDN references. Multipart limits
allow one file and enforce the 25 MiB absolute ceiling; the service can enforce a lower configured
limit. The default `downloadPath` matches this controller. If you customize it, provide matching
routing/proxy behavior or a custom controller.

## Error behavior

Resource identifier, authorization and existence failures intentionally share
`core.file.not-found`. Validation/configured lifecycle failures use stable codes including
`core.file.invalid-upload`, `core.file.invalid-meta`, `core.file.remote-disabled`,
`core.file.remote-fetch-failed`, `core.file.upload-expired`, `core.file.upload-completing`,
`core.file.upload-verification-failed`, `core.file.public-upload-disabled`, `core.file.expired`,
`core.file.upload-failed`, `core.file.delete-failed` and `core.file.cleanup-failed`.

Do not convert non-enumerating service errors into detailed storage or policy diagnostics at the
HTTP boundary.
