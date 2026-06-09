# Design — 8 grouped entry points + unified `SdCoreModule.forRoot` (folded into 1.0.0)

**Date:** 2026-06-08
**Status:** Approved (design phase)
**Repo:** `sdcorejs-nestjs`, branch `release/0.1.0`
**Builds on:** the feature-folders reorg
([2026-06-07-feature-folders-reorg-design.md](./2026-06-07-feature-folders-reorg-design.md)). Two
related parts, sequenced **A then B**, shipped inside the unpublished 1.0.0 (one breaking release).

## 1. Goal

- **Part A — group source + entry points** from the current 8 sub-paths into a smaller, themed set:
  `core`, `auth`, `services`, `queue`, `validation`, `i18n`, `features` (+ root). Cleaner public surface.
- **Part B — one module, one config.** Extend `SdCoreModule.forRoot(config)` so a single import wires
  every lib module (including the feature modules) — each opt-in by the presence of its config key.
  Consumers stop importing/booting 9 modules by hand.

## 2. Decisions (locked)

| Decision | Choice |
|---|---|
| Entry grouping | `core` (orm+context+tenancy+audit) · `auth` (jwt+permission) · `services` (http+cache) · `queue` · `validation` · `i18n` · `features` + root = **8 entries** |
| `queue`, `validation` | Stay their own entry (eager `@nestjs/bullmq` / `zod` — don't bundle into a shared barrel) |
| `core` `UserSnapshot` collision | Drop the re-export in `audit/types.ts` (canonical stays in orm) |
| SdCoreModule composition | Compose ALL modules incl features (`uploadedFile`/`actionHistory`/`jobScheduler`/`queue`), opt-in per config key |
| Feature wiring style | **Eager static import** (backend — no tree-shaking concern). Consequence: `@nestjs/bullmq` + `bullmq` move from optional to **required** peers |
| `validation` in SdCoreModule | NOT composed — it is guards/preset-schemas used directly, not a `forRoot` module |
| Internal-secret | Lib ships a built-in `EnvInternalSecretProvider`; `SdCoreModule.forRoot` accepts an `internalSecret` config so the consumer deletes its glue `@Global` module |
| Tenancy ergonomics | `tenancy` accepts inline `{ resolve, bypass }` callbacks (an adapter wraps them into `ITenancyStrategy`), in addition to the existing `{ strategy }` — so the consumer deletes its dedicated strategy class. Lib stays neutral (policy + column names live in the consumer's callbacks, not the lib) |
| Consumer adoption + verify (Part C) | Build a `.tgz`, vendor it into enterprise-platform, rewire `app.module.ts` to one `SdCoreModule.forRoot`, delete `src/common/internal-secret/` + `src/common/tenancy/`, `npm install`, and verify the app builds + tests pass |
| Sequencing | **A** (group/move) → **B** (SdCoreModule compose + internal-secret + tenancy callbacks) → **C** (consumer adoption + tgz verify) |

## 3. Part A — grouped entry points

### 3.1 Target structure
```
src/
  core/      orm/ context/ tenancy/ audit/ + index.ts   → @sdcorejs/nestjs/core
  auth/      jwt/ permission/ + index.ts                → @sdcorejs/nestjs/auth
  services/  http/ cache/ + index.ts                    → @sdcorejs/nestjs/services
  queue/     (unchanged location)                       → @sdcorejs/nestjs/queue
  validation/                                           → @sdcorejs/nestjs/validation
  i18n/                                                 → @sdcorejs/nestjs/i18n
  features/  action-history/ job-scheduler/ uploaded-file/ + index.ts → @sdcorejs/nestjs/features
  index.ts  sd-core.module.ts  sd-core.types.ts          → @sdcorejs/nestjs (root)
```

### 3.2 Barrels + collision
- `core/index.ts` = `export *` from `./orm`, `./context`, `./tenancy`, `./audit`. Fix the **`UserSnapshot`**
  collision first: remove `export type { UserSnapshot } from '../orm/types/user-snapshot.types'` from
  `audit/types.ts` (orm remains the canonical export; audit's internal code imports it relatively, so
  nothing breaks). Without this, the ambiguous `export *` silently drops `UserSnapshot` from `/core`.
- `auth/index.ts` = `export *` from `./jwt`, `./permission`.
- `services/index.ts` = `export *` from `./http`, `./cache`.
- **Guard tests** (catch silent `export *` holes — tsc/publint/attw will NOT):
  `/core` exports `BaseEntity`, `ContextService`, `ITenancyStrategy`, `IAuditStrategy`, `UserSnapshot`;
  `/auth` exports `AuthGuard`, `JwtModule`, `HasPermission`, `InternalGuard`;
  `/services` exports `HttpService`, `CacheService`, `CacheInterceptor`.

### 3.3 Mechanical scope
- **`orm` relocates to `src/core/orm/`** — referenced by nearly every module. Every relative `../orm`,
  `../context`, `../tenancy`, `../audit` shifts; `tsc` guides the fixups. (Highest-churn move.)
- Root `index.ts` re-exports: `./context`→`./core/context`, `./permission`→`./auth/permission`,
  `./orm`→`./core/orm`, `./i18n` unchanged.
- `sd-core.module.ts` sub-module imports repoint to the new folders (this file is rewritten anyway in Part B).

### 3.4 Config
- `package.json` `exports` + `typesVersions`: replace the current per-module keys with the 7 group keys.
- `tsup.config.ts` `entryMap`: `core/index`, `auth/index`, `services/index`, `queue/index`,
  `validation/index`, `i18n/index`, `features/index` (+ root `index`).
- jest `moduleNameMapper` generic `^@sdcorejs/nestjs/(.*)$` → `src/$1/index.ts` resolves all (folders
  mirror entries) — no special mapping.
- Test import swaps: `@sdcorejs/nestjs/{orm,context,tenancy,audit}` → `/core`; `/jwt`+`/permission` →
  `/auth`; `/http`+`/cache` → `/services`.

## 4. Part B — unified `SdCoreModule.forRoot`

### 4.1 Extend `SdCoreModuleOptions`
Add four opt-in feature keys (typed as each module's `forRoot` parameter, imported from the new
`features/*` locations):
```ts
export interface SdCoreModuleOptions {
  // existing cross-cutting (unchanged):
  context?: ContextModuleOptions;
  tenancy?: TenancyModuleOptions;
  audit?: AuditModuleOptions;
  permission?: PermissionModuleOptions;
  cache?: CacheConfig;
  http?: HttpClientConfig;
  jwt?: JwtConfig;
  i18n?: I18nModuleOptions;
  // NEW — opt-in feature modules (wired only when the key is present):
  uploadedFile?: UploadedFileConfig;
  actionHistory?: ActionHistoryModuleOptions;
  jobScheduler?: JobSchedulerModuleOptions;
  queue?: QueueModuleConfig;
  providers?: Provider[];
}
```

### 4.2 `forRoot` composition
Keep the always-on cross-cutting set (context/tenancy/audit/permission/cache/http). Push each opt-in
module when its key is present — all via plain eager static imports:
```ts
if (options.jwt) imports.push(JwtModule.forRoot(options.jwt));
if (options.i18n) imports.push(I18nModule.forRoot(options.i18n));
if (options.uploadedFile) imports.push(UploadedFileModule.forRoot(options.uploadedFile));
if (options.actionHistory) imports.push(ActionHistoryModule.forRoot(options.actionHistory));
if (options.jobScheduler) imports.push(JobSchedulerModule.forRoot(options.jobScheduler));
if (options.queue) imports.push(QueueModule.forRoot(options.queue));
```
(`jobScheduler: {}` — an empty object still opts in, since `JobSchedulerModule.forRoot()` takes no
required args; document that an explicit empty object enables it.)

### 4.3 Peer-dependency change
Because `QueueModule` is statically imported by `sd-core.module.ts`, importing `SdCoreModule` eagerly
loads `@nestjs/bullmq`. Move `@nestjs/bullmq` and `bullmq` from `peerDependenciesMeta` (optional) to
**required** `peerDependencies` (remove their `optional` entries). `aws-sdk` stays optional (lazy in
the S3 driver); `zod` stays optional (validation isn't composed); `@nestjs/typeorm` is already needed
by the ORM core.

### 4.4 Entity registration (unchanged, documented)
The feature modules register repositories via `TypeOrmModule.forFeature`. Consumers still own their
`TypeOrmModule.forRoot` and must use `autoLoadEntities: true` (or list the entities). SdCoreModule does
not own the DataSource. Document this next to the one-module example.

### 4.5 Consumer result
```ts
@Module({
  imports: [
    SdCoreModule.forRoot({
      context: { headers: { /* ... */ } },
      cache: {}, i18n: { catalogs: APP_CATALOGS },
      tenancy: { strategy: AppTenancyStrategy },
      permission: { strategy: AppPermissionStrategy },
      jwt: { jwks: { allowedIssuers: [/* ... */] } },
      uploadedFile: { bucket: process.env.S3_BUCKET /* ... */ },
      actionHistory: { resolveActor: () => ({ /* ... */ }) },
      jobScheduler: {},
      providers: [{ provide: INTERNAL_SECRET_PROVIDER, useClass: MyProvider }],
    }),
    TypeOrmModule.forRoot({ autoLoadEntities: true, /* ... */ }),
    ...domainModules,
  ],
})
export class AppModule {}
```

### 4.6 Internal-secret default provider
- Ship `EnvInternalSecretProvider implements IInternalSecretProvider` in the permission module:
  `getKey()` returns `process.env[envVar] ?? ''` (default `envVar = 'INTERNAL_SECRET_KEY'`; `''` never
  matches a present header, so internal routes stay closed until configured).
- `SdCoreModuleOptions` gains `internalSecret?: { envVar?: string } | { key: string }`. When present,
  `forRoot` registers `INTERNAL_SECRET_PROVIDER`: `{ envVar }` → `EnvInternalSecretProvider` reading that
  env; `{ key }` → a static-value provider. Still overridable via the `providers:` passthrough for a
  custom source. Neutral — the env var name is config, no secret is baked in.

### 4.7 Tenancy callback option
- `TenancyModuleOptions` accepts EITHER `{ strategy: Type<ITenancyStrategy> }` (existing) OR
  `{ resolve?: (rc: RequestContext) => Record<string, unknown>; bypass?: (rc: RequestContext) => boolean }`.
- When callbacks are given, the lib wires an internal adapter:
  ```ts
  class CallbackTenancyStrategy implements ITenancyStrategy {
    constructor(private readonly o: { resolve?: (rc: RequestContext) => Record<string, unknown>; bypass?: (rc: RequestContext) => boolean }) {}
    getCurrentScope(rc: RequestContext) { return this.o.resolve?.(rc) ?? {}; }
    shouldBypass(rc: RequestContext) { return this.o.bypass?.(rc) ?? false; }
  }
  ```
- The consumer's policy (column names `tenantCode`/`departmentCode`, role checks) lives entirely in its
  callbacks reading `rc.tenant` / `rc.custom.*` — the lib bakes nothing, staying neutral.

## 4C. Part C — consumer adoption + `.tgz` verification

In `enterprise-platform` (`../../local-solution/enterprise-platform`), against the built tarball:
1. Lib: `npm run build && npm pack` → `sdcorejs-nestjs-<v>.tgz`.
2. Copy the tgz into `enterprise-platform/vendor/`, point `package.json`
   `"@sdcorejs/nestjs": "file:vendor/sdcorejs-nestjs-<v>.tgz"` at it, `npm i @nestjs/bullmq bullmq`
   (now required peers — §4.3), `npm install`.
3. Rewire `enterprise-platform/src/app.module.ts`: replace the 9 hand-wired lib modules
   (Context/Cache/I18n/Permission/FileStorage/ActionHistory/JobScheduler/Tenancy + the InternalSecret
   glue) with one `SdCoreModule.forRoot({...})` — tenancy via `resolve`/`bypass` callbacks,
   internal-secret via `internalSecret: { envVar: 'INTERNAL_SECRET_KEY' }`, plus `uploadedFile` /
   `actionHistory` / `jobScheduler` keys. Swap remaining lib import paths to the grouped entries
   (`@sdcorejs/nestjs/core`, `/auth`, `/features`, …).
4. **Delete** `enterprise-platform/src/common/internal-secret/` and `enterprise-platform/src/common/tenancy/`
   and fix importers. The lib's tenancy integration is already covered by lib tests; the app's
   `tenancy.integration.spec.ts` may be dropped or kept as an app-level smoke test.
5. Verify: enterprise-platform builds (`npm run build`) + tests pass; the two folders are gone; the app
   boots with `SdCoreModule.forRoot` as the only lib wiring.

## 5. Verification
Full gate (lib): `lint` · `format:check` · `typecheck` · `test:coverage` · `build` (clean, bundled dts) ·
`check:exports` (publint + attw — **8 entries**, all green) · `pack --dry-run`. Re-check parity
(exports ↔ typesVersions ↔ tsup keys = 8). Add the §3.2 guard tests + a `SdCoreModule.forRoot`
composition test (a `forRoot({...})` with each opt-in key returns a DynamicModule whose `imports`
includes the expected module; omitting a key omits it).

## 6. Docs
- README: sub-path table → 8 rows; rewrite the Quick-start to the single `SdCoreModule.forRoot({...})`
  pattern (incl. the opt-in feature keys + the `autoLoadEntities` note).
- `docs/migration-1.0.md`: entry consolidation rows (`/orm,/context,/tenancy,/audit`→`/core`,
  `/jwt,/permission`→`/auth`, `/http,/cache`→`/services`); note `@nestjs/bullmq`+`bullmq` are now
  required peers; show the SdCoreModule one-module migration.
- `.changeset/core-1-0-0.md`: add the grouping + unified-module + required-bullmq notes.
- audit-findings footnote: note the grouped entries + SdCoreModule composition.

## 7. Out of scope
- No behavior change to any module's internals — only locations, barrels, entry names, the
  `SdCoreModule` wiring, the new internal-secret/tenancy-callback options, and the peer-dep declaration.
- Publishing 1.0.0 to npm + merging the branch (the consumer verification uses the vendored tgz, not a
  published version).
- Reworking enterprise-platform domain modules beyond `app.module.ts` rewiring + deleting the two glue
  folders (Part C touches only the lib-integration surface).

## 8. Acceptance criteria
1. 8 entry points exist (`core`/`auth`/`services`/`queue`/`validation`/`i18n`/`features` + root); old per-module sub-paths gone; folders mirror entries under `src/{core,auth,services,...}/`.
2. `/core` exports the merged surface with no silent omission (`UserSnapshot` present); guard tests pass.
3. `SdCoreModule.forRoot` composes all cross-cutting modules always and the 4 feature modules opt-in per config key; a composition test verifies wiring.
4. `@nestjs/bullmq` + `bullmq` are required peers; `aws-sdk`/`zod` stay optional.
5. Lib ships `EnvInternalSecretProvider` wired via `internalSecret` config; `tenancy` accepts `{ resolve, bypass }` callbacks (adapter) — both verified by tests.
6. `exports`/`typesVersions`/`tsup entryMap` agree on 8 entries; publint + attw green; no stale dirs in the pack.
7. Lib full gate green; all lib tests pass.
8. **Part C:** a `.tgz` is built + vendored into enterprise-platform; `app.module.ts` uses one `SdCoreModule.forRoot`; `src/common/internal-secret/` + `src/common/tenancy/` are deleted; enterprise-platform builds + tests pass.
9. README/migration/changeset/audit-findings reflect the grouped entries + one-module pattern + internal-secret/tenancy options + required bullmq.
