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

Private files are the default. `publicFiles: true` is an explicit security decision and should be
paired with an appropriate bucket/CDN policy and `cdnBaseUrl`.

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
| `upload()`                                 | validate, persist hidden row, write bytes, activate row                  |
| `uploadTemporary()`                        | tracked unused upload; requires positive `cleanupAfterDays`              |
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

| Method | Route                         | Default status | Notes                                                  |
| ------ | ----------------------------- | -------------- | ------------------------------------------------------ |
| POST   | `/uploaded-file`              | 201            | multipart field `file`; optional metadata query fields |
| GET    | `/uploaded-file/:id/download` | 200            | attachment, MIME allowlist, `nosniff`                  |

Both routes use `AuthGuard`. A module/router prefix may add segments. The multipart adapter permits
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

`ScheduleModule.forRoot()` activates the built-in daily 03:00 maintenance job. It always retries
eligible pending deletion claims and also purges unused files older than `cleanupAfterDays` when
configured. Enabling `jobScheduler: {}` fences this sweep across multiple instances.

To retire a tombstone whose producer is permanently gone, first stop/drain every producer and verify
that its generated object cannot still be written. A trusted operator may then call
`unsafeSystemRetireUploadTombstone(id)`; it refuses a live upload/deletion lease and converts only
the exact expired tombstone to ordinary elapsed deletion retry.

::: danger Unsafe maintenance boundary
All `unsafeSystem*` methods intentionally bypass request tenant/owner policy across all tenants.
Call them only from a separately authorized maintenance worker. Their `unsafeSystem` prefix is part
of the contract.
:::

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
