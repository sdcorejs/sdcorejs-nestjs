# Migrating from 1.0.x to 1.1.0 security hardening

Version 1.1.0 changes security defaults and storage/database contracts for shared-database
multi-tenancy. Although published as a minor release, several fail-closed corrections require an
explicit migration. Upgrade the application, database, object store, gateway, and workers as one
coordinated change; do not treat this as a dependency-only rollout.

## Before upgrading

1. Upgrade the runtime to Node.js 20 or 22. NestJS 11 and this package no longer support Node.js 18.
2. Inventory every `@Scoped()` entity, raw TypeORM access, `@Cached()` method, uploaded-file caller,
   action-history reader, and direct `JobSchedulerService` lease mutation.
3. Stop background workers before changing job lease columns. Back up the database and object store.
4. Deploy schema additions as nullable first, backfill and validate them, then apply `NOT NULL` and
   index/unique constraints. Do not use TypeORM `synchronize` for this production migration.

## Trusted request identity

Tenant and user headers are ignored by default. `AuthGuard` maps the verified Passport principal to
request context using `context.identity.principalResolver`. Configure the claim mapping when your JWT
shape does not use the default `sub`/`userId` and `tenant`/`tenantId` fields:

```ts
import { z } from 'zod';

const AppClaimsSchema = z.object({
  sub: z.string().min(1),
  tenant_code: z.string().min(1),
  realm_access: z.object({ roles: z.array(z.string().min(1)) }).optional(),
  permissions: z.array(z.string().min(1)).optional(),
  permission_version: z.string().min(1).optional(),
});

SdCoreModule.forRoot({
  context: {
    identity: {
      principalResolver: (principal: unknown) => {
        const claims = AppClaimsSchema.parse(principal);
        return {
          userId: claims.sub,
          tenant: claims.tenant_code,
          roles: claims.realm_access?.roles ?? [],
          permissions: claims.permissions ?? [],
          permissionVersion: claims.permission_version,
        };
      },
    },
  },
});
```

If a gateway establishes identity, enable trusted headers explicitly and verify a real trust
boundary. The following proof header is illustrative; production systems should validate an
allowlisted proxy address, mTLS peer, or signed gateway assertion:

```ts
context: {
  headers: { tenant: 'x-tenant', userId: 'x-user-id' },
  identity: {
    trustedHeaders: {
      isTrustedRequest: (request) => verifyGatewayBoundary(request),
    },
  },
}
```

The gateway must remove client-supplied identity headers before setting trusted values. If verified
JWT and trusted-header identities both supply different tenant, user, role, permission, or permission
version values, authentication fails instead of choosing one silently.

Outbound identity propagation is also disabled by default. Configure exact HTTP(S) origins only:

```ts
http: {
  baseURL: 'https://orders.internal.example',
  trustedOrigins: ['https://orders.internal.example'],
}
```

Lookalike hosts, subdomains, ports, arbitrary absolute URLs, and untrusted redirect targets do not
receive the configured identity headers. Caller-supplied identity headers are removed before trusted
values are rebuilt from request context. `Authorization` stays caller-owned; `x-internal-secret` is
preserved only for an exact trusted origin and removed before external requests and redirects.

## Fail-closed tenancy

`@Scoped()` is required by default. Mark a dimension optional only when an unscoped value has an
explicit domain meaning:

```ts
@Column() @Scoped() tenantCode!: string;
@Column({ nullable: true }) @Scoped({ required: false }) departmentCode?: string;
```

For required dimensions, `undefined` and `null` throw `MissingTenancyScopeError`; blank strings and
invalid dates throw `InvalidTenancyScopeError`. An empty allowed array produces a match-none
predicate. Scoped entities without a tenancy strategy throw `MissingTenancyContextError`. The same
canonical scope is applied to reads, counts, relation queries, creates, imports, updates, deletes,
soft deletes, restores, and batches. Scope fields cannot be moved through ordinary update input.

Replace boolean bypasses with an authenticated, authorized, and auditable grant:

```ts
tenancy: {
  resolve: (ctx) => ({ tenantCode: ctx.tenant }),
  bypassGrant: (ctx) => {
    if (!ctx.userId || !ctx.roles?.includes('platform-admin')) return undefined;
    return {
      authorized: true,
      actorId: ctx.userId,
      reason: 'approved cross-tenant maintenance',
      // Stable, schema-qualified EntityMetadata.tablePath values only.
      allowedTargets: [dataSource.getMetadata(Product).tablePath],
      allowedOperations: ['read'],
      audit: (event) => privilegedAuditSink.writeSync(event),
    };
  },
}
```

The callback must use a synchronous durable sink and return `void`; the repository rejects
Promise/thenable audit results before granting bypass access.

`shouldBypass()`/the inline `bypass` callback remains only as a deprecated compatibility surface;
returning `true` is rejected. Review and replace all uses.

Raw TypeORM access is now deliberately named `unsafeRepository`, `unsafeGetRepository()`, and
`unsafeCreateQueryRunner()`. These paths do not add tenant predicates. Keep them out of controllers
and request-reachable services, and document any narrowly reviewed maintenance use.

Scoped mutations now check affected rows and reject partial batches. Consumer code should handle the
library's non-enumerating not-found response rather than depending on a prior read followed by a bare
ID mutation.

Mutation helpers accept a caller-owned `QueryRunner` only when it already has an active transaction;
otherwise `InactiveMutationTransactionError` is thrown before SQL. Start/commit/rollback that
transaction in the caller, or omit the runner and let the library create one.

## Uploaded files and object migration

Uploaded files require trusted `tenantCode` and `userId` scope. The default policy is owner-only;
cross-user access is denied even within the same tenant. A policy may grant bounded same-tenant
access, but it cannot remove tenant/department predicates:

```ts
uploadedFile: {
  driver: 's3',
  bucket: process.env.S3_BUCKET,
  region: process.env.AWS_REGION,
  maxFileSizeBytes: 8 * 1024 * 1024,
  allowedMimeTypes: ['image/png', 'application/pdf'],
  resolveScope: (ctx) => ({
    tenantCode: ctx.tenant,
    userId: ctx.userId,
    departmentCode:
      typeof ctx.custom?.departmentCode === 'string'
        ? ctx.custom.departmentCode
        : undefined,
  }),
  authorizationPolicy: ({ context, operation }) =>
    context.roles?.includes('file-admin') && operation !== 'create' ? 'tenant' : 'owner',
  remoteClone: {
    enabled: true,
    allowedHosts: ['assets.example.com'],
    timeoutMs: 5_000,
    maxBytes: 8 * 1024 * 1024,
    maxRedirects: 2,
  },
}
```

This release replaces end-of-support AWS SDK v2 (`aws-sdk`) with the lazy-loaded modular v3 client
`@aws-sdk/client-s3@^3.1090`. Remove `aws-sdk` if no application-owned code imports it. When
`accessId` and `accessKey` are both omitted, `S3Client` uses its default credential provider chain;
this is the preferred path for workload identity. If either value is configured, both must be
non-empty, and S3 mode always requires a nonblank `bucket`. Partial/blank credentials now fail during
module configuration even if the driver was omitted; they no longer select local storage silently.
Configure the region with `uploadedFile.region` or the standard AWS region provider chain. Normal
`UploadedFileService` callers do not interact with SDK commands and require no code change.

Remote cloning is disabled by default. When enabled, only HTTP(S) public addresses are accepted;
every DNS result and redirect target is revalidated, the selected address is pinned for transport,
and time/size/redirect limits are bounded. No request identity headers are forwarded.

New object keys have a server-owned UUID and tenant namespace. The original name remains metadata:

```text
<folder>/tenant/<base64url-tenant>/<file-uuid>/<sanitized-original-name>
```

Migrate existing data in a resumable, checksummed job:

1. Add/backfill non-null `uploaded_file.tenantCode` and `uploaded_file.userId`. Infer both from the
   owning resource; quarantine records whose ownership cannot be proven. Never assign unknown rows
   to a shared fallback tenant.
2. For each row, derive the new key. An existing UUID row ID may be reused as the immutable file UUID.
3. Copy the exact old object to the new key without overwriting, verify byte count and a strong hash,
   then update `key` and `cdn` in one database transaction. Private `cdn` values should use the
   authenticated `/<downloadPath>/<row-id>/download` route.
4. Verify uniqueness and retrieval for every migrated row. Delete old objects only after the new
   release is stable and the backup retention window has passed.
5. Apply/verify unique constraints on `key` and `cdn`, plus the tenant/department/owner lookup index.

The S3 implementation uses AWS SDK v3 `PutObjectCommand` with `If-None-Match: *` to prevent
accidental replacement. Confirm that the selected S3-compatible provider honors this precondition.

Add nullable `uploaded_file.uploadPendingAt` and `uploaded_file.deletionPendingAt` columns plus both
indexes before deploying the new service; existing rows remain `NULL`. `uploadPendingAt` is the exact
activation lease/tombstone, while `deletionPendingAt` is the storage-delete claim. Normal access
requires both fields to be null. Authorized deletion atomically claims the exact scoped row before
storage I/O. A provider or database failure leaves durable retry state.

`UploadedFileCleanupJob` is now always registered. Import `ScheduleModule.forRoot()` even when
age-based cleanup is disabled so pending deletions retry daily, or invoke
`UploadedFileService.unsafeSystemRetryPendingDeletions()` from a separately authenticated,
authorized maintenance worker. The retry service prioritizes settled deletions before unresolved
uploads, and the cron drains at most ten 100-row batches per run. Failed storage/finalization work
is CAS-rescheduled one minute into the future, allowing the next bounded query to advance beyond a
full poison batch. `cleanupAfterDays > 0` additionally purges old unused rows and is now required by
`uploadTemporary()`. Temporary uploads are tracked in the database before object write; the release
no longer relies on S3 `Expires` metadata.
ID/reference batch APIs reject more than 100 items; references are limited to 1024 characters.
Unknown and extensionless upload names are rejected.

Object storage and PostgreSQL do not share a transaction. Both regular and temporary uploads now
persist a hidden, future-dated `uploadPendingAt` lease before writing bytes. Activation CAS-clears
only that exact marker while `deletionPendingAt` is null. Failure cleanup atomically settles the
upload marker into a fresh deletion claim before storage I/O, so late activation affects zero.

Maintenance does not retire an unresolved upload tombstone: after deleting and soft-deleting it,
both the original `uploadPendingAt` and a scheduled deletion claim remain durable. This deliberately
survives producer-process death and causes later sweeps to delete/reschedule until the writer settles.
To retire a permanently abandoned tombstone, first stop/drain all producer processes and verify that
the generated object can no longer appear, then call the trusted-only
`unsafeSystemRetireUploadTombstone(id)`. It refuses to steal a live deletion lease and converts the
exact expired row to ordinary elapsed deletion retry; an unexpired upload lease is also refused.
Alert on old tombstones and retain periodic storage
inventory reconciliation as an operational backstop.

Local storage roots are canonicalized and every key is containment-checked. Do not store absolute
paths in `key`, and do not expose the local root or raw filesystem errors.

The drop-in multipart controller accepts one buffered file with bounded parts/fields and an absolute
25 MiB ceiling; the service applies the lower configured limit, MIME allowlist, extension agreement,
and practical magic-byte validation. For files larger than the ceiling, implement a separately
reviewed streaming/direct-upload workflow with equivalent authorization and validation.

Raw storage drivers and `IUploadedFileStorage` are no longer public. Use the authorized
`UploadedFileService`; its upload signature accepts an optional final `{ contentType }` argument.

## Cache scopes

Every `@Cached()` use must declare a scope:

```ts
@Cached({ scope: 'tenant', ttl: 60 })
listTenantData() {}

@Cached({ scope: 'user', ttl: 30, keyResolver: ({ query }) => query })
listPrivateData() {}
```

Tenant keys include tenant identity and deliberately omit `userId` so explicitly tenant-shared
results can be reused within that tenant; user keys include both tenant and user. Every non-global
namespace also fingerprints all other JSON-safe own request-context fields, including `custom`
values and declaration-merged fields. Roles and permissions are order-normalized. Runtime
request/response objects, tokens, and user objects are excluded. If required identity is missing, or
any selected context/request/business-key value is circular, accessor-backed, non-plain, too deep,
non-finite, or otherwise unsafe to canonicalize, caching is bypassed.

A custom resolver receives a strict HTTP request descriptor plus the handler method name and supplies
only the business suffix; headers and the raw execution context are not exposed, and it cannot
replace the mandatory namespace. Non-HTTP/unsafe descriptors bypass caching. Use `global` only when
a response is identical and public across every tenant, user, locale, and permission state.

Redis now requires an explicit application namespace:

```ts
cache: {
  backend: 'redis',
  fallbackToMemory: false,
  redis: {
    host: 'redis.internal.example',
    port: 6379,
    keyPrefix: 'orders:prod:v2:',
  },
}
```

Choose a unique application/environment/release `keyPrefix`. It must be nonblank and must not contain
Redis glob metacharacters (`*`, `?`, `[`, `]`, or `\\`); there is no shared default. Invalid prefix
configuration throws `InvalidRedisCacheKeyPrefixError` even when memory fallback is enabled. Setting
`fallbackToMemory: false` also makes Redis construction failures fail startup instead of changing the
backend silently. On a shared Redis database, `clear()` and `size()` scan only this prefix and never
use `FLUSHDB`.

The hardened namespace/key format intentionally makes old cache entries unreachable. Roll out with
a new versioned prefix, allow old entries to expire, or delete only the application's previous exact
prefix after validation. Never flush a Redis database shared with another application or environment.

## Job lease fencing

Add a non-null UUID `ownerToken` to `job-scheduler` and an index on `(status, modifiedAt)`. Stop all
workers first, assign a unique token to each existing row, and mark or otherwise reconcile existing
`RUNNING` rows before restart. A PostgreSQL deployment with `pgcrypto` may use `gen_random_uuid()`;
otherwise generate UUIDs in the application migration.

`acquire()` now returns an owner token and a stable logical-run `idempotencyKey`. `heartbeat`,
`complete`, `fail`, and `release` accept a `JobLease` (`{ id, ownerToken }`) and update only a
matching `RUNNING` row. Update direct calls:

```ts
const acquired = await jobs.acquire(options);
if (acquired.acquired) {
  const lease = { id: acquired.id, ownerToken: acquired.ownerToken };
  await outbox.insertUnique(acquired.idempotencyKey, { type: 'SYNC_ORDERS' });
  await jobs.heartbeat(lease);
  await jobs.complete(lease);
}
```

`runExclusive` passes a `JobExecutionLease` to its callback and throws `LostJobLeaseError` if the
worker loses ownership before finalization. Its `idempotencyKey` is stable when a stale lease is
reclaimed; use that key in a unique transactional outbox row or a downstream `Idempotency-Key`
header. Fencing protects database state only and cannot itself make external effects exactly once.

Lease timing is validated before acquisition: `leaseMs` must be a positive safe integer, an enabled
heartbeat must be a non-negative safe integer below half the lease, and an omitted heartbeat derives
the lower of 60 seconds and one third of the lease. Reclaim and heartbeat use the database clock so
worker clock skew does not decide ownership.

Job identity is also breaking. `code` and `runKey` are trimmed before use; `code` must contain 1–64
characters. `SCHEDULE` (the default type) requires a non-empty `runKey` of at most 1024 characters,
while `INITIAL` forbids `runKey`. Invalid input throws `InvalidJobIdentityOptionsError` before SQL.
The unique lock key is now `v2:` plus a SHA-256 base64url digest of the canonical
`{ version: 2, type, code, runKey }` tuple, rather than delimiter-based `code[:runKey]` text.

Do not restart workers until existing lock rows are reconciled. In an application migration, compute
the exact v2 value with Node's
`createHash('sha256').update(JSON.stringify(identity)).digest('base64url')` after applying the same
trimming and type rules. Convert every existing `INITIAL` row before restart; leaving an old key makes
a completed run-once job look absent, so it will be inserted and executed again. The legacy table did
not store `runKey` separately for `SCHEDULE` rows, and its delimiter format can be ambiguous, so
reconstruct it only from an authoritative job inventory. Otherwise archive historical schedule rows
and cut over between ticks, ensuring no logical tick is submitted by both versions. Check for target
key duplicates before updating the unique column, and retain a backup until every run-once and current
scheduled identity has been verified.

## Action history

Add/backfill non-null `action-history.tenantCode`, widen `table` to `varchar(256)`, and create the
composite index on `(tenantCode, table, tableId, createdAt)`. Infer tenancy from the audited resource.
Quarantine or delete rows that cannot be attributed safely according to your retention policy.

The resource identifier stored in `table` is now the stable, schema-qualified TypeORM
`EntityMetadata.tablePath`, not a class name or bare `tableName`. Before backfill, build an
authoritative entity-to-`tablePath` map from each production datasource. Inspect every old bare name
that maps to more than one schema/table path and resolve each historical row from trusted deployment
or ownership data; do not pick one collision arbitrarily. Backfill unambiguous rows, quarantine
unresolved collisions, verify the resulting `(tenantCode, table, tableId)` routes, and only then cut
readers over to the new values.

`BaseRepository` now copies every `@Scoped()` value from the persisted resource into the internal
history `resourceScope`, explicitly selecting scope columns even when TypeORM marks them
`select: false`. The audit tenant is derived from that persisted scope, so an authorized cross-tenant
bypass from tenant A that changes a tenant B row writes the history row under tenant B. Missing
persisted scope fails the mutation with `MissingHistoryResourceScopeError`; a scope that cannot be
mapped to one trusted audit tenant fails with `MissingActionHistoryResourceTenantError`.

The default resource-tenant mapping reads `resourceScope.tenantCode`. Configure a synchronous
`resolveResourceTenant` when an audited entity uses a different tenant property:

```ts
actionHistory: {
  resolveResourceTenant: ({ resourceScope }) =>
    typeof resourceScope.organizationCode === 'string'
      ? resourceScope.organizationCode
      : undefined,
  authorizeRead: ({ context, tenantCode, table, tableId }) =>
    auditPolicy.canRead(context, { tenantCode, table, tableId }),
  redactFields: ['customer.taxId', 'integration.webhookSecret'],
  maxPageSize: 50,
  retentionDays: 365,
}
```

Reads are deny-by-default until `authorizeRead` is configured. They require tenant, resource type,
resource ID, and bounded pagination:

Change service calls from `all(tableId)` to
`all({ table, tableId, pageNumber, pageSize })`. The drop-in route changes from
`GET /action-history/:tableId` to `GET /action-history/:table/:tableId`. Missing and unauthorized
resources both return 404. Built-in recursive redaction removes common password, token, secret,
credential, authorization, API-key, access-key, and private-key fields before storage. Redaction is
mandatory even after a custom `redactSnapshot` transform. Snapshots have fixed defensive limits of
32 levels, 10,000 visited nodes, and 1 MiB of UTF-8 string/path data; exceeding any limit throws
`ActionHistorySnapshotLimitError` before persistence.

Page size has an absolute ceiling of 200. Negative/non-finite page values are normalized, and the
page number is clamped so the database offset never exceeds 100,000 rows; it is not rejected.

`retentionDays` documents the operational policy; the library does not automatically delete audit
rows. Implement retention with legal/privacy approval and tenant-aware deletion controls.

## Illustrative schema sequence

Adapt names, schemas, enum handling, and UUID generation to the consumer migration framework. This
is an ordering guide, not a copy-paste production migration:

```sql
-- Phase 1: additive columns while old code is stopped or dual-write is controlled.
ALTER TABLE "uploaded_file" ADD COLUMN IF NOT EXISTS "tenantCode" varchar(64);
ALTER TABLE "uploaded_file" ADD COLUMN IF NOT EXISTS "userId" uuid;
ALTER TABLE "uploaded_file" ADD COLUMN IF NOT EXISTS "uploadPendingAt" timestamptz;
ALTER TABLE "uploaded_file" ADD COLUMN IF NOT EXISTS "deletionPendingAt" timestamptz;
ALTER TABLE "job-scheduler" ADD COLUMN IF NOT EXISTS "ownerToken" uuid;
ALTER TABLE "action-history" ADD COLUMN IF NOT EXISTS "tenantCode" varchar(64);
ALTER TABLE "action-history" ALTER COLUMN "table" TYPE varchar(256);

-- Phase 2: application-owned backfill/quarantine and object-copy verification happen here.
-- The new nullable pending columns need no data backfill; do not clear live pending/tombstone rows.
-- Map each legacy action-history.table value to the authoritative EntityMetadata.tablePath.
-- Inspect/quarantine ambiguous bare-name collisions before updating any affected history row.

-- Phase 3: only after validation reports zero unknown/null rows.
ALTER TABLE "uploaded_file" ALTER COLUMN "tenantCode" SET NOT NULL;
ALTER TABLE "uploaded_file" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "job-scheduler" ALTER COLUMN "ownerToken" SET NOT NULL;
ALTER TABLE "action-history" ALTER COLUMN "tenantCode" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_uploaded_file_key" ON "uploaded_file" ("key");
CREATE INDEX IF NOT EXISTS "IDX_uploaded_file_upload_pending" ON "uploaded_file" ("uploadPendingAt");
CREATE INDEX IF NOT EXISTS "IDX_uploaded_file_deletion_pending" ON "uploaded_file" ("deletionPendingAt");
CREATE INDEX IF NOT EXISTS "IDX_uploaded_file_tenant_owner_lookup" ON "uploaded_file" ("tenantCode", "departmentCode", "userId", "id");
CREATE INDEX IF NOT EXISTS "IDX_job_scheduler_status_modified" ON "job-scheduler" ("status", "modifiedAt");
CREATE INDEX IF NOT EXISTS "IDX_action_history_resource" ON "action-history" ("tenantCode", "table", "tableId", "createdAt");
```

Run the tenant/user security matrix and object checksum reconciliation before directing production
traffic to the upgraded application.
