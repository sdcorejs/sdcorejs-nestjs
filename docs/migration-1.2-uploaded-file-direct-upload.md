# Uploaded-file direct lifecycle migration

This guide upgrades an existing `uploaded_file` table for direct S3/Spaces upload, per-file
visibility, signed private reads, and fixed 24-hour temporary files. The library remains
schema-agnostic at runtime; the exported migration assumes the default PostgreSQL table and camelCase
column names used by `UploadedFile`.

## Before deployment

1. Back up PostgreSQL and inventory the object prefixes referenced by `key`/`cdn`.
2. Keep TypeORM `synchronize: false` outside disposable environments.
3. Verify the host can use `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` when S3 is selected.
4. Configure S3/Spaces CORS for direct `PUT`, keep the staging prefix private, and add a provider
   lifecycle rule as an orphan-object backstop.
5. Decide whether public access is an object ACL (`object-acl`) or an external bucket/CDN policy
   (`external`). A CDN URL alone does not make an object readable.

## Run the exported migration

```ts
import { DataSource } from 'typeorm';
import { UploadedFileDirectLifecycle1785744000000 } from '@sdcorejs/nestjs/features';

export default new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  migrations: [UploadedFileDirectLifecycle1785744000000],
});
```

Run the consumer application's normal `typeorm migration:run` command before deploying the new
service/controller. The migration is transactional and additive. It adds:

- `sizeBytes`, `contentType`, and private `pendingKey`;
- `visibility`, `status`, `isTemporary`, and `disposition`;
- `uploadExpiredAt`, `completedAt`, and `expiredAt`;
- optional `checksum` and `etag` evidence;
- indexes for pending cleanup, temporary expiry, and tenant/owner/status lookup.

Legacy rows are conservatively backfilled as `visibility = 'private'`, `status = 'ready'`,
`isTemporary = false`, and `disposition = 'attachment'`. Exact size, content type, and timestamps stay
null because rounded `fileSize` and historical storage state cannot reconstruct them safely. Existing
`key`, `cdn`, legacy metadata, soft-delete state, and public methods are not removed.

## Legacy public files

Runtime config `publicFiles: true` normalizes to `defaultVisibility: 'public'` and
`allowPublicUploads: true` for permanent uploads. The database migration does not assume every legacy
row was intentionally public. After reviewing bucket/CDN policy and a verified row inventory, update
only the selected rows, for example:

```sql
UPDATE "uploaded_file"
SET "visibility" = 'public'
WHERE "id" = ANY($1::uuid[]);
```

Do not bulk-mark unknown data public. Pre-migration rows with `type = 'temporary'` remain non-expiring
legacy rows because no trustworthy completion timestamp exists. Every temporary upload completed by
the upgraded service—including the compatibility overload—receives the exact 24-hour lifetime.

## Deployment order

1. Run the database migration.
2. Apply origin CORS, public-access policy, and staging lifecycle policy.
3. Deploy the application code and mount `UploadedFileController` if the canonical HTTP API is used.
4. Import `ScheduleModule.forRoot()` and confirm both configured cleanup jobs are registered.
5. Exercise one private direct upload, one authorized detail/sign operation, and one temporary upload.
6. Enable internal public uploads only after the stable CDN/origin URL is externally readable as
   intended.

The legacy multipart `POST /uploaded-file`, stream download route, Buffer `upload` overload,
`findById`, key/CDN reference mutation methods, and existing columns remain available. New HTTP
responses intentionally do not serialize object keys or persisted URL references.

## Verification

```sql
SELECT "visibility", "status", "isTemporary", count(*)
FROM "uploaded_file"
GROUP BY 1, 2, 3;

SELECT "id", "status", "uploadExpiredAt", "pendingKey"
FROM "uploaded_file"
WHERE "status" IN ('pending', 'completing')
ORDER BY "uploadExpiredAt";

SELECT "id", "completedAt", "expiredAt"
FROM "uploaded_file"
WHERE "isTemporary" = true
  AND "status" = 'ready';
```

For each new ready temporary row, verify `expiredAt - completedAt = interval '24 hours'`. Verify a
detail request returns HTTP 410 at the boundary even before cleanup. Never copy signed PUT/GET URLs
into logs or migration evidence.

## Rollback

First roll application instances back to code that does not write the new columns. The migration's
`down()` drops the three new indexes and all lifecycle columns, so it is destructive to direct-upload
state. Run it only after aborting/draining pending uploads, reconciling staging/final objects, and
backing up the table. Do not run `down()` while any new-version instance or cleanup worker is active.
