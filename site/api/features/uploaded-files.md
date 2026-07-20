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
| `UploadedFileOperation`              | type         | `create`, `read`, `update`, `mark-used`, `delete`, `clone`   |
| `UploadedFileAccessDecision`         | type         | `'owner' \| 'tenant' \| 'deny'`                              |
| `UploadedFileScope`                  | interface    | Tenant, optional department and owner IDs                    |
| `UploadedFileAuthorizationRequest`   | interface    | Policy input with trusted context and bounded resources      |
| `UploadedFileAuthorizationPolicy`    | type         | Async/sync bounded decision callback                         |
| `UploadedFileMeta`                   | interface    | Optional module/entity/entityId/type provenance              |
| `UploadedFileUploadOptions`          | interface    | Optional declared `contentType`                              |
| `UploadedFileResult`                 | interface    | Compact persisted result shape for application adapters      |
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
});
```

Add `UploadedFile` to the datasource. The entity uses UUID, `jsonb`, `timestamptz` and
soft-delete columns and has unique `key`/`cdn` values.

## Configuration

| Option                  | Default / constraint                                                                                                          |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `driver`                | Local unless a complete explicit `accessId` + `accessKey` pair auto-selects S3; explicit `'s3'` uses the AWS credential chain |
| `accessId`, `accessKey` | Optional but must be supplied together and nonblank                                                                           |
| `region`                | AWS SDK provider chain when omitted                                                                                           |
| `bucket`                | Required and nonblank for S3                                                                                                  |
| `folder`                | `'core'`; normalized, traversal segments rejected                                                                             |
| `localRoot`             | `<cwd>/upload`; canonical absolute path                                                                                       |
| `host`                  | Empty; base for authenticated private URLs                                                                                    |
| `cdnBaseUrl`            | Empty; used only with `publicFiles: true`                                                                                     |
| `publicFiles`           | `false`; explicit opt-in is required                                                                                          |
| `downloadPath`          | `'uploaded-file'`                                                                                                             |
| `maxFileSizeBytes`      | 10 MiB default; clamped to the absolute 25 MiB ceiling                                                                        |
| `allowedMimeTypes`      | JSON, PDF, ZIP, GIF, JPEG, PNG, WebP, CSV and plain text                                                                      |
| `validateMagicBytes`    | `true`                                                                                                                        |
| `remoteClone`           | Disabled; defaults 5s, at most service size, 3 redirects (absolute max 5)                                                     |
| `resolveScope`          | Falls back to `ctx.tenant`, `ctx.userId`, then matching `ctx.custom` fields                                                   |
| `authorizationPolicy`   | Owner-only when absent                                                                                                        |
| `cleanupAfterDays`      | Age purge disabled when omitted/non-positive; required positive finite value for temporary uploads                            |

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
| `upload<T>`                         | `(buffer, fileName?, meta?, extraData?, options?) => Promise<UploadedFile<T>>`             |
| `uploadTemporary`                   | `(buffer, fileName?, options?) => Promise<{ key, cdn }>`                                   |
| `cloneFromUrl<T>`                   | `(url, fileName?, meta?, extraData?) => Promise<UploadedFile<T>>`                          |
| `download`                          | `(id) => Promise<{ stream, fileName }>`                                                    |
| `findById<T>`                       | `(id) => Promise<UploadedFile<T>>`                                                         |
| `setExtraData<T>`                   | `(id, extraData: Partial<T>) => Promise<void>`                                             |
| `markUsed`                          | `(ids, meta?) => Promise<void>`                                                            |
| `useFiles`                          | `(references, entity?, entityId?) => Promise<void>`                                        |
| `delete`                            | `(references) => Promise<void>`; durable object deletion                                   |
| `changeFiles`                       | `(olds, news, entity?, entityId?) => Promise<void>`                                        |
| `unsafeSystemRetryPendingDeletions` | `(limit = 100) => Promise<number>`; cross-tenant maintenance only                          |
| `unsafeSystemRetireUploadTombstone` | `(id) => Promise<boolean>`; operator-confirmed abandoned upload only                       |
| `unsafeSystemPurgeUnusedBefore`     | `(cutoff) => Promise<number>`; cross-tenant maintenance only                               |

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

## Durable pending lifecycle

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

`UploadedFileModule` registers the daily 03:00 maintenance provider. Import
`ScheduleModule.forRoot()` in the host to activate cron. Pending deletions are retried even when
`cleanupAfterDays` is disabled; age-based purge of unused rows runs only with positive retention.
When `JobSchedulerService` is also available, the cron uses a distributed daily lock.

::: warning Unsafe maintenance API
All `unsafeSystem*` methods intentionally bypass request tenant/owner policy across all tenants.
Invoke them only from trusted background maintenance code; never expose them directly in an HTTP
controller.
:::

## Optional controller

`UploadedFileController` is not auto-registered. Add it to an application module's `controllers`:

| Route                             | Behavior                                                                             |
| --------------------------------- | ------------------------------------------------------------------------------------ |
| `POST /uploaded-file`             | Multipart field `file`; optional `module`, `entity`, `entityId`, `type` query params |
| `GET /uploaded-file/:id/download` | Authorized stream with allowlisted type, `nosniff` and attachment disposition        |

Both routes use `AuthGuard`; service policy still enforces tenant/owner access. Multipart limits
allow one file and enforce the 25 MiB absolute ceiling; the service can enforce a lower configured
limit. The default `downloadPath` matches this controller. If you customize it, provide matching
routing/proxy behavior or a custom controller.

## Error behavior

Resource identifier, authorization and existence failures intentionally share
`core.file.not-found`. Validation/configured lifecycle failures use stable codes including
`core.file.invalid-upload`, `core.file.invalid-meta`, `core.file.remote-disabled`,
`core.file.remote-fetch-failed`, `core.file.temporary-cleanup-required`, `core.file.upload-failed`,
`core.file.delete-failed` and `core.file.cleanup-failed`.

Do not convert non-enumerating service errors into detailed storage or policy diagnostics at the
HTTP boundary.
