# Changelog

## 1.1.2

### Patch Changes

- fdcb22b: Validate DOCX, XLSX and PPTX containers with bounded ZIP inspection, allow consumers to narrow upload limits per call, participate in caller-owned file-claim transactions, and authorize exact attached-file reads through a deny-by-default policy.

## 1.1.1

### Patch Changes

- 619b948: Adopt `@sdcorejs/utils` 1.2 filter validation and operand semantics, preserve empty membership filters, harden action-history snapshots, and add the `zUuidV4` validation preset.
- Require TypeORM 0.3.31 or newer to include the upstream migration-generator security fix.

## 1.1.0

### Minor Changes

> This minor release corrects security defaults and persistence contracts. Existing applications
> must follow `docs/migration-1.1-security-hardening.md` before deployment.

- **Trusted identity and authorization:** derive request identity from a verified Passport principal
  or an explicitly trusted gateway, reject conflicting sources, harden internal-secret rotation and
  enrichment, and keep missing/denied resources non-enumerating.
- **Fail-closed tenancy and ORM:** apply canonical `@Scoped()` predicates to reads, relations,
  creates/imports, every mutation and batch; require bounded audited bypass grants; protect
  caller-owned transactions and affected-row counts; expose raw TypeORM access only as `unsafe*`.
  `detail()` now excludes soft-deleted rows unless `{ withDeleted: true }` is explicit.
- **Cache, HTTP, JWT and configuration:** require cache scope, isolate Redis prefixes, constrain
  identity propagation to exact trusted origins/redirects, use bearer-first cookie fallback in both
  symmetric and JWKS strategies, reject ambiguous JWT modes, and fail fast on partial S3 credentials
  or missing S3 buckets. AWS SDK v2 was replaced by modular `@aws-sdk/client-s3` v3.
- **Uploaded files:** add trusted tenant/owner policy, immutable tenant-namespaced keys, bounded
  multipart/MIME/signature validation, SSRF-hardened remote cloning, private download responses, and
  pending-first database/object consistency with separate activation tombstones and deletion claims,
  exact-state CAS, crash-durable bounded maintenance retry, settled-work priority, poison-row retry
  backoff, and explicit operator reconciliation for abandoned uploads.
- **History and jobs:** authorize action-history reads by tenant/resource, redact and bound snapshots,
  attribute persisted resource scope, fence job leases with rotating owner tokens/database-clock
  heartbeats, and expose a stable logical-run `idempotencyKey` for consumer outbox/deduplication.
- **Validation, i18n and packaging:** align zero-based page-size validation with the repository cap of
  200, cover every production `core.*` code in English/Vietnamese catalogs, require Node.js 20+, and
  preserve shared Nest DI identities across all eight CJS/ESM public entry points.
- **Documentation and verification:** rebuild the VitePress portal with global left navigation,
  complete public API reference, source-backed guides, compile-checked consumer example, security /
  schema / REST references, 1.1.0 release notes, and automated link/API coverage gates.
- **Dependency security:** require Axios 1.18+, refresh Express's transitive `body-parser` to 2.3+,
  and pin the supported audit-clean esbuild 0.27.2 toolchain while retaining the documented,
  build-tested VitePress/Vite compatibility exception.

## 1.0.0

### Major Changes

- e63997a: 1.0.0 — first stable release.

  Clean-break public API standardization: removed `Sd*` type aliases, the `/tenancy`
  re-export of ORM decorators, the `/orm` re-export of `@sdcorejs/utils/fns`, and
  internal-helper/metadata-key leaks from module barrels (orm/context/cache/validation/i18n,
  file-storage). Declared `ioredis` as an optional peer dependency. Bundled per-format type
  declarations so `exports` resolve cleanly under ESM and CJS (publint + attw green). Added
  `publint` + `attw` validation. See `docs/migration-1.0.md`. Feature modules (action-history, job-scheduler, uploaded-file) consolidated under a single `@sdcorejs/nestjs/features` entry (`src/features/`); entities live with their module; `FileEntity`→`UploadedFile`, table `file`→`uploaded_file`. Entry points grouped into core/auth/services (+ queue/validation/i18n/features). `SdCoreModule.forRoot` now composes every module (features opt-in per config key) with a built-in `internalSecret` provider and inline `tenancy` `{resolve,bypass}` callbacks. `@nestjs/bullmq` + `@nestjs/schedule` are bundled dependencies (auto-installed). The uploaded-file module gained an opt-in `cleanupAfterDays` config: when set (`> 0`) it runs a fixed daily 03:00 `@Cron` sweep that purges never-attached files (`isUsed=false`) older than N days. Requires the host to import `@nestjs/schedule` `ScheduleModule.forRoot()`; uses the job-scheduler distributed lock when that feature is also wired. The `UploadedFile` entity is now generic (`UploadedFile<TExtraData>`) with an `extraData` jsonb column for consumer-defined metadata, and `UploadedFileService` gained `upload`/`download(id)`/`findById`/`setExtraData` (storage driver resolved lazily) so a consumer can expose file routes without writing its own file service. Ready-made `UploadedFileController` (`POST uploaded-file` + `GET uploaded-file/:id/download`) and `ActionHistoryController` (`GET action-history/:tableId`) — both guarded by the lib `AuthGuard` and named to match their entity/table — are exported for consumers to drop into a module's `controllers` array (each inherits that module's route prefix). `@nestjs/platform-express` is a bundled dependency (the file controller uses `FileInterceptor`). The scoping decorator `@TenantScoped` is **removed** (the deprecated alias) — use `@Scoped()`; its internal constants/metadata keys were de-tenant-renamed (`TENANT_SCOPED_*`→`SCOPED_*`, `sdcore:tenant:scoped*`→`sdcore:scoped*`) and the file renamed to `scoped.decorator.ts`. Dependency restructure for zero-config install: **peer dependencies are now just `@nestjs/common` + `@nestjs/core`** (`^11`) — every NestJS app already has them, and they stay peers so the library shares the app's DI container. Everything previously a required peer moved to bundled `dependencies` (auto-installed on any package manager): `@nestjs/passport`, `@nestjs/typeorm`, `@nestjs/bullmq`, `@nestjs/schedule`, `@nestjs/platform-express`, `typeorm`, `reflect-metadata`, `rxjs` (joining `@sdcorejs/utils`, `axios`, `bullmq`, `passport`, `passport-jwt`). The optional feature libs (`ioredis`, `zod`, `jwks-rsa`, `jsonwebtoken`, `aws-sdk`) moved to `optionalDependencies` (auto-installed, non-fatal). Note: `typeorm`/`reflect-metadata` are singletons — npm hoists one copy when the consumer's versions are compatible (uniform across the NestJS 11 ecosystem).

  Final-review hardening (behavior changes to note when migrating): `BaseController` no longer exposes `GET /all` (unbounded read not safe by default — `all()` stays on the service/repository; add it per-entity in a subclass). `paging` caps `pageSize` at 200 (`BaseRepository.MAX_PAGE_SIZE`); missing/non-positive `pageSize` → 10; pages are 0-based. `search` by UUID is now tenancy-scoped (previously bypassed tenancy → cross-tenant id leak). `KeycloakJwtStrategy` now requires an issuer policy — `jwks.allowedIssuers`, the new `jwks.allowedIssuerHosts` (origin allowlist for dynamic multi-realm), or `jwks.issuerValidator` (predicate); it throws if none is set (closes issuer-spoofing + SSRF). `CacheService` releases its backend on shutdown (`OnModuleDestroy`); `@Cached` single-flights concurrent misses via `cache.load` (stampede protection; single-value handlers only). The i18n exception filter localizes per-field Zod issue messages in `data.issues[]`. `JobSchedulerService` reclaims a stale `RUNNING` lock after a lease (default 15 min, `JobAcquireOptions.leaseMs`) so a crashed node no longer wedges it. uploaded-file: `upload()` defaults a missing `fileName` to `TEMP`, `uploadTemporary` is async, `useFiles` no longer NULL-overwrites an owner, cleanup `runKey` is the run day. `QueueModule.registerQueue` no longer shadows root `defaultJobOptions`. Removed the dead `HttpClientConfig.retries` field.

All notable changes to `@sdcorejs/nestjs` are documented here.
Versions are managed with Changesets; compatibility-impacting releases include explicit migration
guidance.
Release notes from 1.0.0 onward are generated by [Changesets](https://github.com/changesets/changesets).
