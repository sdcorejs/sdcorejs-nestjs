# HANDOFF — `@sdcorejs/nestjs` 1.0.0 prep

**Date:** 2026-06-08
**Branch:** `release/0.1.0` (pushed to `origin`, **NOT merged, NOT published**)
**Status:** Library work complete + full gate green. Remaining: consumer adoption (enterprise-platform) + publish.

---

## TL;DR

This branch turns the preview `0.1.6` library into a clean, stable **1.0.0**: standardized public API,
grouped entry points, and a single `SdCoreModule.forRoot(config)` that wires everything. All library
changes are committed and pushed. What's left is **Part C** (adopt the build in `enterprise-platform`
and delete its glue folders) and the **publish** (npm). Both are detailed below.

To resume on another machine:
```bash
git clone <repo> && cd sdcorejs-nestjs && git checkout release/0.1.0
npm ci
npm run lint && npm run typecheck && npm run test:coverage && npm run build && npm run check:exports
npm pack   # → sdcorejs-nestjs-0.1.6.tgz (for the enterprise-platform verification)
```

---

## Follow-up — uploaded-file / action-history features (2026-06-08, on `release/0.1.0`)

5 commits added ON TOP of the 1.0.0-prep work below — the branch advanced, so **re-push `release/0.1.0`**:
`2c08f1d` `43db3cb` `a2bf538` `56457fc` `23d4b97`.
- `UploadedFileConfig.cleanupAfterDays` → opt-in daily **03:00 `@Cron`** orphan-file purge (`isUsed=false`
  older than N days; optional job-scheduler `runExclusive` lock).
- `UploadedFile<TExtraData>` generic + `extraData` jsonb; `UploadedFileService` gained
  `upload` / `download(id)` / `findById` / `setExtraData` (storage driver resolved lazily via `ModuleRef`).
- Drop-in `UploadedFileController` (`@Controller('uploaded-file')`) + `ActionHistoryController`
  (`@Controller('action-history')`), guarded by the lib `AuthGuard`; exported from `@sdcorejs/nestjs/features`,
  NOT auto-registered (consumer adds to a module's `controllers` to inherit its route prefix).
- **New required peers** (added to `peerDependencies`): `@nestjs/schedule` + `@nestjs/platform-express`.
  Full required-peer set is now `@nestjs/bullmq` + `bullmq` + `@nestjs/schedule` + `@nestjs/platform-express`.
- `.changeset/core-1-0-0.md` updated with all the above — still a single **major** bump (`0.1.6`→`1.0.0`).
- Gate green: lint · typecheck · **314 tests** · check:exports 🌟 · build · pack.

Consumer adoption of all of the above lives on the `enterprise-platform` branch `feat/adopt-sdcorejs-1.0`
(see that repo's `HANDOFF.md`).

---

## What is DONE (committed on `release/0.1.0`)

Driven by three spec/plan pairs under `docs/superpowers/` (read these for full detail):
- `specs|plans/2026-06-07-core-1.0.0-standardization-release.md` — API standardization + release CI.
- `specs|plans/2026-06-07-feature-folders-reorg.md` — features layout (supersedes a central-entities attempt).
- `specs|plans/2026-06-08-grouped-entries-unified-module.md` — grouped entries + unified module.
- Findings: `specs/2026-06-07-1.0.0-api-audit-findings.md`.

### 1. Clean-break API standardization
- Removed `Sd*` type aliases, the `/tenancy`→ORM decorator re-export, the `/orm`→`@sdcorejs/utils/fns`
  re-export, and internal metadata-key/helper leaks across modules. Removed the dead `src/utils/` barrel.
- Declared `ioredis` optional peer; added **publint + attw** validation (`npm run check:exports`).
- **Dual-package types**: `tsup` emits bundled per-format declarations (`.d.mts` ESM / `.d.ts` CJS);
  `exports` use nested per-format `types` conditions. publint + attw are green on every entry
  (node10 / node16-CJS / node16-ESM / bundler).
- Release CI: `.github/workflows/release.yml` uses `changesets/action` on push to `main`
  (NPM_TOKEN + provenance); `ci.yml` runs lint/format/typecheck/test/build/check:exports.
- A **major** changeset is staged at `.changeset/core-1-0-0.md` (will bump `0.1.6` → `1.0.0`).

### 2. Renames + reorg
- `file-storage` → **`uploaded-file`** end-to-end: `FileEntity` → **`UploadedFile`**, table
  `file` → **`uploaded_file`**, `FileStorageModule`/`FileStorageConfig`/`IFileStorageService`/
  `Aws|LocalFileStorageService`/`FILE_STORAGE_CONFIG`/`FileUploadMeta`/`UploadResult` →
  `UploadedFile*` / `IUploadedFileStorage` / `UPLOADED_FILE_CONFIG` / `UploadedFileMeta` / `UploadedFileResult`.
- Source grouped under folders: `src/core/{orm,context,tenancy,audit}`, `src/auth/{jwt,permission}`,
  `src/services/{http,cache}`, `src/features/{action-history,job-scheduler,uploaded-file}`, plus
  `src/queue`, `src/validation`, `src/i18n`.

### 3. Final public entry points (8)
| Entry | Contains |
|---|---|
| `@sdcorejs/nestjs` | `SdCoreModule` + curated root re-exports |
| `@sdcorejs/nestjs/core` | base classes (orm), request context, tenancy, audit |
| `@sdcorejs/nestjs/auth` | JWT/Keycloak strategies + permission guards/decorators |
| `@sdcorejs/nestjs/services` | HTTP client + cache |
| `@sdcorejs/nestjs/queue` | BullMQ queue (separate — eager `@nestjs/bullmq`) |
| `@sdcorejs/nestjs/validation` | Zod guard + preset schemas (separate — eager `zod`) |
| `@sdcorejs/nestjs/i18n` | i18n resolver + exception filter |
| `@sdcorejs/nestjs/features` | `ActionHistory`, `JobScheduler`, `UploadedFile` entities + services + modules |

### 4. Unified `SdCoreModule.forRoot(config)`
Composes every module from one config. Always-on: context, tenancy, audit, permission, cache, http.
Opt-in (wired only when the key is present): `jwt`, `i18n`, `uploadedFile`, `actionHistory`,
`jobScheduler`, `queue`. Plus:
- `internalSecret?: { envVar?: string } | { key: string }` → wires the built-in
  `EnvInternalSecretProvider` (default env `INTERNAL_SECRET_KEY`).
- `tenancy` accepts EITHER `{ strategy: Class }` OR inline `{ resolve(rc), bypass(rc) }` callbacks
  (a `CallbackTenancyStrategy` adapter wraps them) — no custom strategy class needed.

```ts
SdCoreModule.forRoot({
  context: { headers: { /* ... */ } }, cache: {}, i18n: { catalogs },
  permission: { strategy: MyPermissionStrategy },
  internalSecret: { envVar: 'INTERNAL_SECRET_KEY' },
  tenancy: {
    bypass: (rc) => rc.custom?.isMaster === true || !!rc.custom?.internalSecret,
    resolve: (rc) => rc.custom?.isTenantAdmin
      ? { tenantCode: rc.tenant }
      : { tenantCode: rc.tenant, departmentCode: rc.custom?.departmentCode },
  },
  jwt: { jwks: { allowedIssuers: [/* ... */] } },
  uploadedFile: { bucket: process.env.S3_BUCKET /* ... */ },
  actionHistory: { resolveActor: () => ({ /* ... */ }) },
  jobScheduler: {},
})
```

### ⚠️ Breaking-change notes (vs 0.1.x)
- All per-module sub-paths gone → import from the 8 grouped entries above.
- `@nestjs/bullmq` + `bullmq` are now **REQUIRED** peer dependencies (SdCoreModule statically imports
  QueueModule). `aws-sdk` + `zod` stay optional.
- Entity table `file` → `uploaded_file` (consumers need a rename migration).
- Coverage thresholds were lowered to the suite's real floor (branches 65, functions 72) — there's a
  TODO in `jest.config.cjs` to raise them post-1.0.

### Gate status (all green on this branch)
`lint` · `format:check` · `typecheck` · `test:coverage` (304 tests) · `build` · `check:exports`
(publint + attw 🌟, 8 entries) · `npm pack --dry-run` (no stale dirs).

---

## What REMAINS

### A. Part C — adopt the build in `enterprise-platform`, delete glue folders
Full steps: Task 7 in `docs/superpowers/plans/2026-06-08-grouped-entries-unified-module.md`. Summary:
1. In the lib: `npm run build && npm pack` → `sdcorejs-nestjs-0.1.6.tgz`.
2. In `enterprise-platform`: copy the tgz into `vendor/`, point `package.json`
   `"@sdcorejs/nestjs": "file:vendor/sdcorejs-nestjs-0.1.6.tgz"`, `npm i @nestjs/bullmq bullmq`
   (now required), `rm -rf node_modules/@sdcorejs/nestjs && npm install`.
3. Rewire `enterprise-platform/src/app.module.ts`: replace the 9 hand-wired lib modules
   (Context/Cache/I18n/Permission/FileStorage/ActionHistory/JobScheduler/Tenancy + the
   `InternalSecretModule` glue) with one `SdCoreModule.forRoot({...})` — tenancy via `resolve`/`bypass`
   callbacks, `internalSecret: { envVar: 'INTERNAL_SECRET_KEY' }`, plus uploadedFile/actionHistory/
   jobScheduler keys. Swap remaining lib imports to grouped entries (`@sdcorejs/nestjs/core`, `/auth`,
   `/features`).
4. **Delete** `enterprise-platform/src/common/internal-secret/` and
   `enterprise-platform/src/common/tenancy/` (their logic now lives in the lib + SdCoreModule config).
   Fix importers. Add a DB migration: `ALTER TABLE "file" RENAME TO "uploaded_file";`.
5. Verify: `npm run build` + tests pass; the two folders are gone; the app boots with
   `SdCoreModule.forRoot` as the only lib wiring.
   - The callback `rc.custom.*` keys must match what the app's context binding actually populates —
     confirm against `enterprise-platform/src/common/context`.

Do this on a branch in the enterprise-platform repo (its own convention; not `main` without consent).

### B. Publish 1.0.0
1. Ensure the GitHub repo secret **`NPM_TOKEN`** exists (Settings → Secrets → Actions).
2. Open a PR `release/0.1.0` → `main` and merge it (compare URL:
   `https://github.com/sdcorejs/sdcorejs-nestjs/compare/main...release/0.1.0?expand=1`; `gh` was not
   authenticated in this environment, so open it in the browser).
3. Merging to `main` triggers `changesets/action` → it opens a **"Version Packages"** PR (bumps
   `0.1.6` → `1.0.0`, writes CHANGELOG from `.changeset/core-1-0-0.md`).
4. Merge the "Version Packages" PR → CI publishes `1.0.0` to npm (provenance on).

---

## Resume checklist (other machine)
- [ ] `git checkout release/0.1.0 && git pull && npm ci`
- [ ] Re-run the gate (commands at top) — confirm green.
- [ ] `npm pack` → vendor the tgz into enterprise-platform; do Part C.
- [ ] Verify enterprise-platform builds + the two glue folders are deleted.
- [ ] Confirm `NPM_TOKEN` secret, then merge to `main` → merge the Version Packages PR → 1.0.0 published.
