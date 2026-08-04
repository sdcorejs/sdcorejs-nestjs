# Uploaded files

The uploaded-file feature persists metadata in PostgreSQL and bytes in local storage or S3. Every
ordinary service operation resolves a trusted tenant and owner, applies a bounded authorization
decision, and returns the same 404 for missing and unauthorized resources.

## Enable local storage

```ts
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SdCoreModule } from '@sdcorejs/nestjs';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.DATABASE_URL,
      autoLoadEntities: true,
      synchronize: false,
    }),
    ScheduleModule.forRoot(),
    SdCoreModule.forRoot({
      uploadedFile: {
        driver: 'local',
        localRoot: './var/uploads',
        host: 'https://api.example.com',
        cleanupAfterDays: 7,
        maxFileSizeBytes: 8 * 1024 * 1024,
        allowedMimeTypes: ['image/png', 'image/jpeg', 'application/pdf'],
      },
    }),
  ],
})
export class AppModule {}
```

`localRoot` is canonicalized, and object keys are server-generated tenant namespaces. Original
filenames are metadata; they cannot choose the storage path.

## Enable S3 (AWS SDK v3)

```ts
const bucket = process.env.S3_BUCKET;
if (!bucket) throw new Error('S3_BUCKET is required');

SdCoreModule.forRoot({
  uploadedFile: {
    driver: 's3',
    bucket,
    region: process.env.AWS_REGION,
    folder: 'orders',
    cleanupAfterDays: 7,
  },
});
```

The focused snippet reuses the root import above. The S3 driver lazy-loads
`@aws-sdk/client-s3` (AWS SDK v3). Omit `accessId` and `accessKey` to use the standard AWS
credential-provider chain. If either explicit credential is configured, both must be nonblank.
Selecting `driver: 's3'` requires a bucket. The legacy `aws-sdk` v2 package is not used.

Private files are the default. Prefer `defaultVisibility`, `allowPublicUploads`, and
`publicAccessMode`; legacy `publicFiles: true` normalizes to public permanent uploads plus public
internal opt-in, but temporary files remain private.

## Direct upload control plane and data plane {#direct-upload-control-plane-and-data-plane}

For S3 and DigitalOcean Spaces, the backend is the control plane and object storage is the data
plane. The browser never receives credentials, bucket names, or object keys:

1. `POST /uploaded-file/initiate` validates metadata, creates a private `pending` row, and returns one
   short-lived provider-neutral upload target.
2. The browser sends the file directly using the returned method and every returned header.
3. `POST /uploaded-file/:id/complete` authorizes the owner, checks the staging object with `HEAD`,
   verifies exact size/content type/upload metadata, claims completion with CAS, and promotes by
   storage-side copy/move.
4. The backend marks the row `ready` and returns a preview URL. Repeated completion is idempotent;
   replaying the staging PUT cannot overwrite the ready final object.

```ts
const initiated = (await api.post('/uploaded-file/initiate', {
  originalName: file.name,
  contentType: file.type,
  size: file.size,
})).data;

await fetch(initiated.upload.url, {
  method: initiated.upload.method,
  headers: initiated.upload.headers,
  body: file,
});

const uploadedFile = (await api.post(`/uploaded-file/${initiated.id}/complete`)).data;
preview.src = uploadedFile.url;
```

The local driver returns the same contract, but its target is the authenticated
`PUT /uploaded-file/:id/content` route. The frontend does not branch on provider.
The local target uses `application/octet-stream` only as raw transport so Nest body parsers cannot
transform JSON bytes; the row retains the validated `contentType`.

## Visibility, URL, and temporary expiry {#visibility-url-and-temporary-expiry}

| Ready file | Detail `url` | `urlExpiredAt` |
| --- | --- | --- |
| Public | Stable `cdnBaseUrl` or S3-compatible origin URL | `null` |
| Private S3/Spaces | Newly generated presigned GET | At most one hour |
| Private local | Protected application download route | `null` |
| Pending/completing/failed | `null` | `null` |

Generic browser initiate is always private. Public upload is an internal service decision and is
rejected unless `allowPublicUploads: true`. With `publicAccessMode: 'object-acl'`, promotion sends
`public-read`; with `'external'`, no ACL is sent and the operator must provide a reviewed bucket/CDN
policy. A CDN hostname only controls URL construction and does not make an object public.

Temporary initiate is always private and accepts neither `visibility`, `ttlSeconds`, nor `expiredAt`.
At successful completion, `expiredAt` is set to exactly `completedAt + 24 elapsed hours`. Access is
rejected at `now >= expiredAt` even if cleanup has not run. Its last presigned GET is clamped so the
reported `urlExpiredAt` never exceeds file expiry.

```ts
const temporary = (await api.post('/uploaded-file/temporary/initiate', {
  originalName: file.name,
  contentType: file.type,
  size: file.size,
})).data;
// PUT with temporary.upload, then POST /uploaded-file/:id/complete.
```

Signed PUT/GET URLs are bearer credentials: do not persist or log them, and do not place them in
analytics events. Detail checks tenant/owner authorization before signing.

## S3, Spaces, CDN, and CORS {#s3-spaces-cdn-and-cors}

AWS S3 uses its normal regional origin. DigitalOcean Spaces supplies an S3-compatible origin through
`endpoint`; the presigned PUT always uses that origin, while public reads may use `cdnBaseUrl`:

```ts
uploadedFile: {
  driver: 's3',
  bucket: process.env.SPACES_BUCKET,
  region: 'sgp1',
  endpoint: 'https://sgp1.digitaloceanspaces.com',
  forcePathStyle: false,
  cdnBaseUrl: 'https://assets.example.com',
  defaultVisibility: 'private',
  allowPublicUploads: true,
  publicAccessMode: 'external',
}
```

Example bucket CORS (narrow the origin and headers for the application):

```json
[
  {
    "AllowedOrigins": ["https://app.example.com"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["content-type", "x-amz-meta-*", "x-amz-checksum-sha256"],
    "ExposeHeaders": ["etag"],
    "MaxAgeSeconds": 600
  }
]
```

The signed `content-length` binds the exact object size. Browsers manage this forbidden request
header automatically; callers should send the returned upload headers without replacing them.

Use placeholders in configuration examples and workload identity where available. Never ship storage
credentials to a browser. Keep the staging prefix private and configure a provider lifecycle rule as
an operational backstop for objects that outlive database recovery.

## Scope and authorization

```ts
uploadedFile: {
  driver: 'local',
  localRoot: './var/uploads',
  cleanupAfterDays: 7,
  resolveScope: (context) => ({
    tenantCode: context.tenant,
    departmentCode:
      typeof context.custom?.departmentCode === 'string'
        ? context.custom.departmentCode
        : undefined,
    userId: context.userId,
  }),
  authorizationPolicy: ({ context, operation }) => {
    if (context.roles?.includes('file-admin') && operation === 'read') {
      return 'tenant';
    }
    return 'owner';
  },
},
```

This fragment belongs inside `SdCoreModule.forRoot({...})`. Scope requires a nonblank tenant and a
UUID user ID. The policy may return only `owner`, `tenant`, or `deny`; the mandatory tenant and
optional department predicates can never be removed. The default is owner-only.

## Service API

```ts
import { Injectable } from '@nestjs/common';
import { UploadedFileService } from '@sdcorejs/nestjs/features';

interface InvoiceFileData {
  checksum: string;
}

@Injectable()
class InvoiceAttachmentService {
  constructor(private readonly files: UploadedFileService) {}

  upload(pdf: Buffer, invoiceId: string) {
    return this.files.upload<InvoiceFileData>(
      pdf,
      'invoice.pdf',
      { module: 'billing', entity: 'invoice', entityId: invoiceId },
      { checksum: 'application-computed-checksum' },
      { contentType: 'application/pdf' },
    );
  }
}
```

| Method                                     | Purpose                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------ |
| `upload()`                                 | legacy Buffer overload, or managed `initiate → PUT/write → complete`     |
| `uploadTemporary()`                        | legacy result overload, or managed private upload with exact 24h expiry  |
| `initiateUpload()`                         | private provider-neutral browser upload target                           |
| `initiateTemporaryUpload()`                | private temporary browser upload target                                  |
| `completeUpload()` / `abortUpload()`       | verify/promote ready object, or durably abort pending work                |
| `find()` / `resolveUrl()`                  | safe URL-aware detail or a fresh authorized URL                           |
| `deleteById()`                             | delete final and retained staging bytes through the durable outbox        |
| `cleanupPendingUploads()`                  | bounded pending/staging/deletion retry sweep                              |
| `cleanupExpiredTemporaryFiles()`           | bounded CAS claim and deletion of expired ready temporary files           |
| `cloneFromUrl()`                           | explicitly enabled, SSRF-hardened remote fetch followed by normal upload |
| `download(id)`                             | authorized stream and sanitized filename                                 |
| `findById(id)`                             | authorized active metadata                                               |
| `setExtraData(id, data)`                   | scoped metadata replacement                                              |
| `markUsed(ids, meta?)`                     | mark a bounded UUID batch used                                           |
| `useFiles(references, entity?, entityId?)` | mark exact key/private-URL references used                               |
| `delete(references)`                       | durable scoped deletion                                                  |
| `changeFiles(olds, news, ...)`             | attach new references, then delete removed references                    |

ID/reference batches are capped at 100; references are capped at 1024 characters. Metadata strings
are bounded and `entityId` must be a UUID.

The managed internal overload accepts `Buffer | Uint8Array | Readable`. A `Readable` requires an
exact `options.size`; it is consumed once and is not retried. The service sends exactly the signed
method/headers, checks the response, completes the upload, and best-effort aborts without masking the
original error.

```ts
// CMS cover: stable public URL; requires allowPublicUploads.
const cover = await files.upload(buffer, 'cover.png', { module: 'cms', type: 'cover' }, ownerId, {
  contentType: 'image/png',
  visibility: 'public',
  disposition: 'inline',
});

// Contract/HRM attachment: short-lived private preview URL.
const contract = await files.upload(buffer, 'contract.pdf', { module: 'hrm', type: 'contract' }, ownerId, {
  contentType: 'application/pdf',
  visibility: 'private',
});

// Temporary preview: always private; no caller-controlled TTL.
const temporary = await files.uploadTemporary(buffer, 'preview.png', { module: 'cms' }, ownerId, {
  contentType: 'image/png',
});
```

::: warning Domain authorization remains application-owned
`module`, `entity`, `entityId`, and `type` record provenance only. Before calling `upload`,
`markUsed`, `useFiles`, or `changeFiles`, load the target order/invoice/etc. inside the current tenant
and enforce the caller's domain permission. The file policy cannot prove access to that resource.
:::

## Mount the private controller explicitly

`UploadedFileModule` does not auto-register an HTTP controller. Mount it only when the application
intends to expose the built-in authenticated routes:

```ts
import { Module } from '@nestjs/common';
import { UploadedFileController } from '@sdcorejs/nestjs/features';

@Module({
  controllers: [UploadedFileController],
})
export class FileHttpModule {}
```

Routes:

| Method | Route                                   | Default status | Notes                                                    |
| ------ | --------------------------------------- | -------------- | -------------------------------------------------------- |
| POST   | `/uploaded-file/initiate`               | 201            | private pending metadata; provider-neutral upload target |
| POST   | `/uploaded-file/temporary/initiate`     | 201            | private pending temporary upload                         |
| POST   | `/uploaded-file/:id/complete`           | 201            | empty body; verifies and promotes                         |
| PUT    | `/uploaded-file/:id/content`            | 200            | bounded local-driver binary target                        |
| GET    | `/uploaded-file/:id`                    | 200            | authorized detail plus usable preview URL                 |
| DELETE | `/uploaded-file/:id`                    | 200            | abort pending or delete ready; `{ data: null }`           |
| POST   | `/uploaded-file`                        | 201            | deprecated multipart compatibility route                  |
| GET    | `/uploaded-file/:id/download`           | 200            | compatibility stream, MIME allowlist, `nosniff`           |

Every route uses `AuthGuard`. A module/router prefix may add segments. Initiate rejects unknown
fields, including public visibility, TTL, bucket, and object key. HTTP results omit `key`,
`pendingKey`, and persisted `cdn`. The multipart adapter permits
one file, four fields, five total parts, and applies the 25 MiB absolute ceiling before the lower
configured service limit.

Configure `jwt` in `SdCoreModule` (or import a custom `JwtModule`) before mounting this
controller. The verified principal must resolve to a UUID user ID and a tenant usable by file scope.

## Durable pending-first lifecycle

A normal or temporary upload follows this order:

1. validate input and generate the immutable key;
2. save a hidden database row with an exact `uploadPendingAt` activation lease;
3. write the object;
4. conditionally activate the exact pending row.

Activation clears only the exact original upload lease while `deletionPendingAt` is null. Failed or
ambiguous writes atomically settle that marker into a deletion claim before cleanup. Active reads
require both pending fields to be null.

Maintenance keeps an unresolved `uploadPendingAt` tombstone plus a scheduled deletion claim even
after soft deletion. If a slow object write completes after cleanup, the live writer settles and
deletes it; if the producer process dies, later sweeps keep deleting and rescheduling the tombstone.
Settled deletions are prioritized and the daily job drains bounded batches, so abandoned tombstones
cannot starve ordinary cleanup. A storage/finalization failure is rescheduled with a one-minute
future backoff; the next bounded query can therefore reach later rows instead of selecting the same
poison batch repeatedly.

Deletion similarly marks authorized rows pending before deleting bytes and soft-deleting rows.

`ScheduleModule.forRoot()` activates two configurable jobs. `pendingCleanupInterval` defaults to
`0 3 * * *`; it retires expired direct uploads after their in-flight safety lease, removes retained
staging objects, retries the durable deletion outbox, and optionally purges unused legacy rows older
than `cleanupAfterDays`. `temporaryCleanupInterval` defaults to `*/15 * * * *` and claims ready rows
with `expiredAt <= now`. `cleanupBatchSize` defaults to 100 and is capped at 100. Enabling
`jobScheduler: {}` adds a distributed scheduler lock; row-level CAS and idempotent storage deletion
remain the correctness boundary across instances.

To retire a tombstone whose producer is permanently gone, first stop/drain every producer and verify
that its generated object cannot still be written. A trusted operator may then call
`unsafeSystemRetireUploadTombstone(id)`; it refuses a live upload/deletion lease and converts only
the exact expired tombstone to ordinary elapsed deletion retry.

::: danger Unsafe maintenance boundary
All `unsafeSystem*` methods intentionally bypass request tenant/owner policy across all tenants.
Call them only from a separately authorized maintenance worker. Their `unsafeSystem` prefix is part
of the contract.
:::

## Migration {#migration}

Register and run `UploadedFileDirectLifecycle1785744000000` before deploying code that creates direct
uploads. It adds only nullable/defaulted columns and cleanup indexes, then backfills legacy rows as
`private`, `ready`, and non-temporary. It deliberately leaves exact `sizeBytes`, `contentType`, and
completion/expiry timestamps null because they cannot be reconstructed safely from rounded legacy
metadata. Existing `key`, `cdn`, multipart calls, and download routes remain intact.

If a deployment intentionally used `publicFiles: true`, review bucket/CDN access and explicitly
backfill only the rows that should remain public after the conservative migration. Do not mark all
legacy data public by assumption. See [the 1.1 → 1.2 migration guide](/migrations/1.1-to-1.2).

## Remote cloning

Remote cloning is off by default:

```ts
remoteClone: {
  enabled: true,
  allowedHosts: ['assets.example.com'],
  timeoutMs: 5_000,
  maxBytes: 8 * 1024 * 1024,
  maxRedirects: 2,
},
```

The fetcher accepts HTTP(S), rejects URL credentials and non-public addresses, validates every DNS
answer, pins the selected address, revalidates every redirect, and applies bounded time/size/redirect
limits. Keep `allowedHosts` narrow even though public-address checks are also enforced.
