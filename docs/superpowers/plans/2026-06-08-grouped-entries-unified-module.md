# Grouped Entries + Unified SdCoreModule Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Group the lib into 8 themed entry points (`core`/`auth`/`services`/`queue`/`validation`/`i18n`/`features`), make `SdCoreModule.forRoot` compose every module (features opt-in), add a built-in internal-secret provider + tenancy callbacks, then verify by vendoring a `.tgz` into enterprise-platform and deleting its glue folders — all folded into the unpublished 1.0.0.

**Architecture:** Phase A is a pure move/regroup of source folders + entry points (no behavior change). Phase B extends `SdCoreModule` wiring + adds two consumer-ergonomic options. Phase C adopts the tgz in enterprise-platform and removes its `internal-secret`/`tenancy` glue. Each task keeps build + tests + publint/attw green.

**Tech Stack:** TypeScript, NestJS 11, TypeORM, tsup (bundled dual ESM/CJS dts), Jest, publint/attw.

**Spec:** [docs/superpowers/specs/2026-06-08-grouped-entries-unified-module-design.md](../specs/2026-06-08-grouped-entries-unified-module-design.md)

**Branch:** `release/0.1.0` (lib); enterprise-platform changes happen in that repo (`../../local-solution/enterprise-platform`).

**Starting state:** post feature-folders reorg — 8 sub-paths (root + orm, context, tenancy, audit, permission, cache, http, jwt, validation, queue, i18n, features). `tsup` bundled dts; `package.json` exports use nested per-format conditions; `exports`/`typesVersions`/`tsup entryMap` in sync. `SdCoreModule.forRoot` composes context/tenancy/audit/permission/cache/http + opt jwt/i18n.

**Conventions:** Bash for git/jest/tsc (Windows; absolute paths or `cd` in one invocation). `npm run typecheck` · `npx jest` · `npm run build && npm run check:exports` · `npm run lint` (no-unused-vars = ERROR). Lib full gate adds `npm run format:check` + `npm run test:coverage` + `npm pack --dry-run`.

---

### Task 1 (Phase A): Group source + entry points into `core` / `auth` / `services`

One atomic regroup — intermediate states don't build, so it lands as a single commit. Steps in order; verify at Step 9.

**Moves:** `orm`,`context`,`tenancy`,`audit` → `src/core/*`; `jwt`,`permission` → `src/auth/*`; `http`,`cache` → `src/services/*`. `queue`,`validation`,`i18n`,`features` stay. New barrels: `src/core/index.ts`, `src/auth/index.ts`, `src/services/index.ts`.

- [ ] **Step 1: Move the folders**

```bash
mkdir -p src/core src/auth src/services
git mv src/orm src/core/orm
git mv src/context src/core/context
git mv src/tenancy src/core/tenancy
git mv src/audit src/core/audit
git mv src/jwt src/auth/jwt
git mv src/permission src/auth/permission
git mv src/http src/services/http
git mv src/cache src/services/cache
```

- [ ] **Step 2: Fix the `UserSnapshot` collision (before building core barrel)**

In `src/core/audit/types.ts`, delete the line `export type { UserSnapshot } from '../orm/types/user-snapshot.types';` (now `'../../core/...'`? — it's a sibling: from `src/core/audit/types.ts` the orm path is `'../orm/types/user-snapshot.types'`). Removing it entirely is the fix — orm remains the canonical export. Confirm audit's own code imports `UserSnapshot` directly where needed (with-audit.ts already imports from `../types/user-snapshot.types` inside orm; audit strategy/subscriber import from orm path) and does not rely on the deleted re-export.

- [ ] **Step 3: Create the group barrels**

`src/core/index.ts`:
```ts
export * from './orm';
export * from './context';
export * from './tenancy';
export * from './audit';
```
`src/auth/index.ts`:
```ts
export * from './jwt';
export * from './permission';
```
`src/services/index.ts`:
```ts
export * from './http';
export * from './cache';
```

- [ ] **Step 4: Fix relative imports broken by the extra level**

Modules gained one directory level (e.g. `src/orm/` → `src/core/orm/`). Two parts:
1. Imports BETWEEN modules now in the same group are unchanged in depth IF referenced as siblings, but most cross-refs used `../<module>` from a top-level module. Find every relative import that crossed a module boundary:
```bash
git grep -nE "from '(\.\./)+(orm|context|tenancy|audit|jwt|permission|http|cache|i18n|validation|queue|sd-core|features)" -- src
```
2. For each hit, rewrite the path to the module's NEW location relative to the importing file's NEW location. Rules of thumb:
   - From a file now under `src/core/<m>/…` importing another core module → `../<other>` (sibling within core). E.g. `src/core/audit/audit.subscriber.ts` importing orm → `../orm/...`.
   - From a file under `src/core/<m>/…` importing an `auth`/`services`/top-level module → `../../auth/<m>/...`, `../../services/<m>/...`, `../../<top>/...`.
   - From `src/auth/<m>/…` or `src/services/<m>/…` importing a core module → `../../core/<m>/...`.
   - Top-level files (`src/index.ts`, `src/sd-core.module.ts`, `src/sd-core.types.ts`) → see Steps 5–6.

Drive `npm run typecheck` to 0 errors — it pinpoints every wrong path. Iterate until clean.

- [ ] **Step 5: Repoint `src/index.ts` (root barrel)**

Update each relative re-export to the new location: `./context/*` → `./core/context/*`; `./tenancy/*` → `./core/tenancy/*`; `./audit/*` → `./core/audit/*`; `./permission/*` → `./auth/permission/*`; `./orm/*` → `./core/orm/*`. `./validation` and `./i18n` unchanged. (Read the file; fix every import line.)

- [ ] **Step 6: Repoint `src/sd-core.module.ts`**

Update the sub-module imports: `./context/context.module` → `./core/context/context.module`; `./tenancy/tenancy.module` → `./core/tenancy/tenancy.module`; `./audit/audit.module` → `./core/audit/audit.module`; `./permission/permission.module` → `./auth/permission/permission.module`; `./cache/cache.module` → `./services/cache/cache.module`; `./http/http.module` → `./services/http/http.module`; `./jwt/jwt.module` → `./auth/jwt/jwt.module`; `./i18n/i18n.module` unchanged. Also `src/sd-core.types.ts` option-type imports follow the same repointing.

- [ ] **Step 7: Update config (exports / typesVersions / tsup)**

In `package.json` `exports`: remove `./orm`, `./context`, `./tenancy`, `./audit`, `./jwt`, `./permission`, `./http`, `./cache`; add `./core`, `./auth`, `./services` (mirror an existing nested block, pointing at `./dist/esm/<group>/index.d.mts` + `.mjs`, `./dist/cjs/<group>/index.d.ts` + `.cjs`). Keep `./queue`, `./validation`, `./i18n`, `./features`, `.`.
In `typesVersions["*"]`: remove the 8 old keys, add `"core"`,`"auth"`,`"services"` → `["./dist/cjs/<group>/index.d.ts"]`.
In `tsup.config.ts` `entryMap`: remove the 8 old `'<m>/index'` entries, add `'core/index': 'src/core/index.ts'`, `'auth/index': 'src/auth/index.ts'`, `'services/index': 'src/services/index.ts'`. Keep queue/validation/i18n/features/index.

- [ ] **Step 8: Swap test imports + add guard tests**

```bash
git grep -nE "@sdcorejs/nestjs/(orm|context|tenancy|audit|jwt|permission|http|cache)" -- src test
```
Map: `{orm,context,tenancy,audit}` → `@sdcorejs/nestjs/core`; `{jwt,permission}` → `@sdcorejs/nestjs/auth`; `{http,cache}` → `@sdcorejs/nestjs/services`. Update every hit.
Move/keep the existing per-module guard specs under their new folders (they moved with `git mv`). Create `src/core/group-api.spec.ts`:
```ts
import * as core from './index';
describe('core entry', () => {
  it('exposes orm + context + tenancy + audit surface (no silent export* hole)', () => {
    const c = core as Record<string, unknown>;
    for (const sym of ['BaseEntity', 'ContextService', 'ITenancyStrategy', 'IAuditStrategy', 'UserSnapshot']) {
      expect(c[sym]).toBeDefined();
    }
  });
});
```
(`ITenancyStrategy`/`IAuditStrategy`/`UserSnapshot` are types — to assert them at runtime, instead assert a runtime sibling from each module; use `ContextService`, `AuditSubscriber`, `DefaultTenancyStrategy`, `BaseEntity`, and for UserSnapshot rely on the build/typecheck. Adjust the list to runtime values: `['BaseEntity','ContextService','DefaultTenancyStrategy','AuditSubscriber','DefaultAuditStrategy']`.)
Create `src/auth/group-api.spec.ts` asserting `['AuthGuard','JwtModule','InternalGuard']` defined and `src/services/group-api.spec.ts` asserting `['HttpService','CacheService','CacheInterceptor']` defined.

- [ ] **Step 9: Verify + commit**

```bash
npm run lint && npm run typecheck && npx jest && npm run build && npm run check:exports
```
Expect: lint 0; tsc 0; tests pass; build OK; publint/attw "No problems found 🌟" with **8 entries** incl `/core`,`/auth`,`/services`, none of the 8 old per-module sub-paths. Then `npm pack --dry-run 2>/dev/null | grep -cE "dist/(esm|cjs)/(orm|context|tenancy|audit|jwt|permission|http|cache)/"` → expect `0`.
```bash
git add -A
git commit -m "refactor!: group modules into core/auth/services entry points

BREAKING CHANGE: @sdcorejs/nestjs/{orm,context,tenancy,audit} -> /core;
/{jwt,permission} -> /auth; /{http,cache} -> /services. UserSnapshot de-duplicated."
```

---

### Task 2 (Phase B): Built-in internal-secret provider

**Files:** `src/auth/permission/internal-secret.provider.ts` (add default class), `src/auth/permission/permission.module.ts` (accept option) OR wire in `sd-core.module.ts`; `src/sd-core.types.ts`; test.

- [ ] **Step 1: Write the failing test**

Create `src/auth/permission/env-internal-secret.provider.spec.ts`:
```ts
import { EnvInternalSecretProvider } from './internal-secret.provider';

describe('EnvInternalSecretProvider', () => {
  afterEach(() => { delete process.env.TEST_SECRET; });
  it('reads the configured env var, empty when unset', () => {
    const p = new EnvInternalSecretProvider('TEST_SECRET');
    expect(p.getKey()).toBe('');
    process.env.TEST_SECRET = 's3cr3t';
    expect(p.getKey()).toBe('s3cr3t');
  });
});
```
Run `npx jest src/auth/permission/env-internal-secret.provider.spec.ts` → FAIL (class not defined).

- [ ] **Step 2: Implement the provider**

In `src/auth/permission/internal-secret.provider.ts`, add (next to the existing `INTERNAL_SECRET_PROVIDER` token + `IInternalSecretProvider` interface):
```ts
import { Injectable } from '@nestjs/common';

/**
 * Default {@link IInternalSecretProvider}: returns the secret from `process.env[envVar]`
 * (default `INTERNAL_SECRET_KEY`), or `''` when unset — `''` never matches a present header,
 * so internal routes stay closed until a secret is configured.
 */
@Injectable()
export class EnvInternalSecretProvider implements IInternalSecretProvider {
  constructor(private readonly envVar: string = 'INTERNAL_SECRET_KEY') {}
  getKey(): string {
    return process.env[this.envVar] ?? '';
  }
}
```
Export it from `src/auth/permission/index.ts` (add to the barrel).

- [ ] **Step 3: Accept `internalSecret` in SdCoreModuleOptions + wire it**

In `src/sd-core.types.ts` add to `SdCoreModuleOptions`:
```ts
/** Wire the built-in internal-secret provider for `InternalGuard`. `{ envVar }` reads that env
 *  (default `INTERNAL_SECRET_KEY`); `{ key }` uses a static value. Override via `providers` for a custom source. */
internalSecret?: { envVar?: string } | { key: string };
```
In `src/sd-core.module.ts` `forRoot`, when `options.internalSecret` is set, push a provider into `providers`:
```ts
import { INTERNAL_SECRET_PROVIDER, EnvInternalSecretProvider } from './auth/permission';
// ...
const extraProviders: Provider[] = [...(options.providers ?? [])];
if (options.internalSecret) {
  const cfg = options.internalSecret;
  extraProviders.push(
    'key' in cfg
      ? { provide: INTERNAL_SECRET_PROVIDER, useValue: { getKey: () => cfg.key } }
      : { provide: INTERNAL_SECRET_PROVIDER, useFactory: () => new EnvInternalSecretProvider(cfg.envVar) },
  );
}
// use extraProviders in place of providers in the returned module (providers + exports)
```
Ensure `INTERNAL_SECRET_PROVIDER` is exported by the returned module so the global `InternalGuard` resolves it.

- [ ] **Step 4: Test the wiring**

Add to a new `src/sd-core.module.spec.ts` (or extend the existing one) a test that `SdCoreModule.forRoot({ internalSecret: { envVar: 'X' } })` returns a DynamicModule whose `providers` includes a binding for `INTERNAL_SECRET_PROVIDER`.
Run `npx jest src/auth/permission/env-internal-secret.provider.spec.ts src/sd-core.module.spec.ts` → PASS. Then `npm run typecheck`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(auth): built-in EnvInternalSecretProvider wired via SdCoreModule internalSecret option"
```

---

### Task 3 (Phase B): Tenancy callback option

**Files:** `src/core/tenancy/tenancy.module.ts` (or a new `callback-tenancy.strategy.ts`), `src/core/tenancy/index.ts`, test.

- [ ] **Step 1: Write the failing test**

Create `src/core/tenancy/callback-tenancy.strategy.spec.ts`:
```ts
import { CallbackTenancyStrategy } from './callback-tenancy.strategy';
import type { RequestContext } from '../context/context.types';

const rc = { tenant: 't1', custom: { departmentCode: 'd1', isMaster: false } } as unknown as RequestContext;

describe('CallbackTenancyStrategy', () => {
  it('delegates resolve + bypass to the callbacks', () => {
    const s = new CallbackTenancyStrategy({
      resolve: (c) => ({ tenantCode: c.tenant, departmentCode: c.custom?.departmentCode }),
      bypass: (c) => c.custom?.isMaster === true,
    });
    expect(s.getCurrentScope(rc)).toEqual({ tenantCode: 't1', departmentCode: 'd1' });
    expect(s.shouldBypass(rc)).toBe(false);
  });
  it('defaults: empty scope, no bypass', () => {
    const s = new CallbackTenancyStrategy({});
    expect(s.getCurrentScope(rc)).toEqual({});
    expect(s.shouldBypass(rc)).toBe(false);
  });
});
```
Run it → FAIL.

- [ ] **Step 2: Implement the adapter**

Create `src/core/tenancy/callback-tenancy.strategy.ts`:
```ts
import type { RequestContext } from '../context/context.types';
import type { ITenancyStrategy } from './strategy.interface';

export interface TenancyCallbacks {
  resolve?: (rc: RequestContext) => Record<string, unknown>;
  bypass?: (rc: RequestContext) => boolean;
}

/** Wraps inline `resolve`/`bypass` callbacks into an {@link ITenancyStrategy} — lets consumers
 *  express tenancy policy in `SdCoreModule.forRoot` config instead of a dedicated strategy class. */
export class CallbackTenancyStrategy implements ITenancyStrategy {
  constructor(private readonly cb: TenancyCallbacks) {}
  getCurrentScope(rc: RequestContext): Record<string, unknown> {
    return this.cb.resolve?.(rc) ?? {};
  }
  shouldBypass(rc: RequestContext): boolean {
    return this.cb.bypass?.(rc) ?? false;
  }
}
```
Export from `src/core/tenancy/index.ts`. (Verify the actual `ITenancyStrategy` method signatures in `strategy.interface.ts` and match them exactly.)

- [ ] **Step 3: Accept callbacks in TenancyModuleOptions**

In `src/core/tenancy/tenancy.module.ts`, extend `TenancyModuleOptions` to allow callbacks alongside `strategy`, and in `forRoot` wire `CallbackTenancyStrategy` when `resolve`/`bypass` are provided (and no `strategy`). Read the current `TenancyModule.forRoot` to match its provider/registry wiring (it registers the strategy into the tenancy registry). Add `resolve?`/`bypass?` to the options type.

- [ ] **Step 4: Test passes + typecheck**

Run `npx jest src/core/tenancy` → PASS. `npm run typecheck` → 0.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(tenancy): accept inline {resolve,bypass} callbacks (CallbackTenancyStrategy adapter)"
```

---

### Task 4 (Phase B): Compose feature modules in SdCoreModule + make bullmq a required peer

**Files:** `src/sd-core.types.ts`, `src/sd-core.module.ts`, `package.json` (peer deps), test.

- [ ] **Step 1: Write the failing composition test**

Extend `src/sd-core.module.spec.ts`:
```ts
import { SdCoreModule } from './sd-core.module';

describe('SdCoreModule.forRoot feature composition', () => {
  it('omits feature modules when their config key is absent', () => {
    const mod = SdCoreModule.forRoot({});
    const names = (mod.imports ?? []).map((m: any) => (m.module ?? m).name);
    expect(names).not.toContain('UploadedFileModule');
    expect(names).not.toContain('QueueModule');
  });
  it('wires a feature module when its config key is present', () => {
    const mod = SdCoreModule.forRoot({ actionHistory: { resolveActor: () => ({}) } as any });
    const names = (mod.imports ?? []).map((m: any) => (m.module ?? m).name);
    expect(names).toContain('ActionHistoryModule');
  });
});
```
Run → FAIL (keys not wired yet).

- [ ] **Step 2: Extend `SdCoreModuleOptions`**

In `src/sd-core.types.ts` add (import the option types from the feature barrels):
```ts
import type { UploadedFileConfig, ActionHistoryModuleOptions, JobSchedulerModuleOptions } from './features';
import type { QueueModuleConfig } from './queue';
// in the interface:
uploadedFile?: UploadedFileConfig;
actionHistory?: ActionHistoryModuleOptions;
jobScheduler?: JobSchedulerModuleOptions;
queue?: QueueModuleConfig;
```
(Confirm the exact exported type names from `src/features/index.ts` + `src/queue/index.ts`.)

- [ ] **Step 3: Wire opt-in feature modules in `forRoot`**

In `src/sd-core.module.ts`, add static imports of the feature modules + QueueModule, and push each when its key is present:
```ts
import { UploadedFileModule, ActionHistoryModule, JobSchedulerModule } from './features';
import { QueueModule } from './queue';
// ... inside forRoot, after the jwt/i18n pushes:
if (options.uploadedFile) imports.push(UploadedFileModule.forRoot(options.uploadedFile));
if (options.actionHistory) imports.push(ActionHistoryModule.forRoot(options.actionHistory));
if (options.jobScheduler) imports.push(JobSchedulerModule.forRoot(options.jobScheduler));
if (options.queue) imports.push(QueueModule.forRoot(options.queue));
```
(`features/index.ts` aggregates the three feature modules; confirm they're exported there. If `features` barrel doesn't export the module classes, import from the specific feature paths.)

- [ ] **Step 4: Move bullmq to required peers**

In `package.json`: remove the `"@nestjs/bullmq"` and `"bullmq"` entries from `peerDependenciesMeta` (so they're no longer optional). Keep them in `peerDependencies`. Leave `aws-sdk`, `zod`, `ioredis`, etc. as-is.

- [ ] **Step 5: Verify**

Run `npx jest src/sd-core.module.spec.ts && npm run typecheck && npm run build && npm run check:exports` → composition test PASS; tsc 0; build OK; publint/attw green (still 8 entries).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: SdCoreModule.forRoot composes feature modules opt-in; bullmq now a required peer

BREAKING CHANGE: @nestjs/bullmq + bullmq are required peerDependencies (SdCoreModule statically
imports QueueModule). uploadedFile/actionHistory/jobScheduler/queue config keys wire their modules."
```

---

### Task 5: Docs

**Files:** `README.md`, `docs/migration-1.0.md`, `.changeset/core-1-0-0.md`, `docs/superpowers/specs/2026-06-07-1.0.0-api-audit-findings.md`

- [ ] **Step 1: README**

Sub-path table → 8 rows (`core`, `auth`, `services`, `queue`, `validation`, `i18n`, `features` + describe root). Rewrite Quick-start to the single `SdCoreModule.forRoot({...})` pattern incl. `internalSecret`, `tenancy:{resolve,bypass}`, and opt-in `uploadedFile`/`actionHistory`/`jobScheduler`/`queue` keys + the `TypeOrmModule.forRoot({ autoLoadEntities: true })` note. State `@nestjs/bullmq`+`bullmq` are required peers.

- [ ] **Step 2: migration-1.0.md**

Add rows: `/orm,/context,/tenancy,/audit → /core`; `/jwt,/permission → /auth`; `/http,/cache → /services`. Note bullmq required. Show the before/after of `app.module.ts` collapsing 9 modules into one `SdCoreModule.forRoot`, plus the `internalSecret` config + `tenancy:{resolve,bypass}` replacing custom glue.

- [ ] **Step 3: changeset + audit-findings**

`.changeset/core-1-0-0.md`: append the grouping (8 entries) + unified-module + internalSecret/tenancy-callbacks + required-bullmq notes (keep `major`). audit-findings footnote: note the grouped entries + SdCoreModule composition.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/migration-1.0.md .changeset/core-1-0-0.md docs/superpowers/specs/2026-06-07-1.0.0-api-audit-findings.md
git commit -m "docs: grouped entries + unified SdCoreModule pattern + required bullmq"
```

---

### Task 6: Lib final gate + build the tarball

**Files:** none (verification + artifact)

- [ ] **Step 1: Full gate**

```bash
npm run lint && npm run format:check && npm run typecheck && npm run test:coverage && npm run build && npm run check:exports && npm pack --dry-run
```
Expect: all exit 0; publint/attw "No problems found"; 8 entries; pack carries `dist/{esm,cjs}/{core,auth,services,queue,validation,i18n,features}/` and no stale per-module dirs. If `format:check` fails, `npm run format` and commit `style: prettier --write`.

- [ ] **Step 2: Build the tarball**

```bash
npm run build && npm pack
```
Note the produced file name `sdcorejs-nestjs-<version>.tgz` (version is still `0.1.6` pre-release — the tgz is for local verification, not publish).

- [ ] **Step 3: Push the lib branch (no merge)**

```bash
git push origin release/0.1.0
```

---

### Task 7 (Phase C): Adopt the tgz in enterprise-platform; delete glue folders

Work in `c:\Users\Admin\Documents\local-solution\enterprise-platform` (a separate git repo — branch there per its own convention; do NOT touch its `main` without consent — create a branch).

- [ ] **Step 1: Vendor the tarball + install peers**

```bash
cp c:/Users/Admin/Documents/sdcorejs/sdcorejs-nestjs/sdcorejs-nestjs-*.tgz vendor/
```
Update `package.json` `"@sdcorejs/nestjs": "file:vendor/sdcorejs-nestjs-<version>.tgz"`, then:
```bash
npm i --save-dev @nestjs/bullmq bullmq   # now required peers
rm -rf node_modules/@sdcorejs/nestjs && npm install
```

- [ ] **Step 2: Rewire `src/app.module.ts` to one `SdCoreModule.forRoot`**

Replace the 9 separately-imported lib modules (ContextModule, CacheModule, I18nModule, PermissionModule.forRoot, FileStorageModule.forRoot, ActionHistoryModule.forRoot, JobSchedulerModule.forRoot, TenancyModule.forRoot + the InternalSecretModule glue) with:
```ts
import { SdCoreModule } from '@sdcorejs/nestjs';
// ...
SdCoreModule.forRoot({
  context: { headers: { /* existing header map */ } },
  cache: {},
  i18n: { fallbackLanguage: 'vi', supportedLanguages: ['vi', 'en'], catalogs: APP_CATALOGS },
  permission: { strategy: AdminPermissionStrategy },
  internalSecret: { envVar: 'INTERNAL_SECRET_KEY' },
  tenancy: {
    bypass: (rc) => rc.custom?.isMaster === true || !!rc.custom?.internalSecret,
    resolve: (rc) => rc.custom?.isTenantAdmin
      ? { tenantCode: rc.tenant }
      : { tenantCode: rc.tenant, departmentCode: rc.custom?.departmentCode },
  },
  uploadedFile: { accessId: process.env.S3_ACCESS_ID, accessKey: process.env.S3_ACCESS_KEY, bucket: process.env.S3_BUCKET, folder: 'enterprise', cdnBaseUrl: process.env.CDN_BASE_URL },
  actionHistory: { resolveActor: () => ({ userId: SdContext.userId, username: SdContext.username, fullName: SdContext.fullName }) },
  jobScheduler: {},
}),
```
Adjust the `tenancy` callbacks to read whatever keys the app's context actually populates (`rc.custom.*` — confirm against the app's context binding; the values previously read from `SdContext` map to `rc.custom`). Swap remaining lib import paths to grouped entries (`@sdcorejs/nestjs/core` for ContextService etc., `@sdcorejs/nestjs/auth` for guards/permission, `@sdcorejs/nestjs/features` for `UploadedFile`/feature services). Keep app-specific modules (SdJwtModule, PagePermissionModule, domain modules) as-is.

- [ ] **Step 3: Delete the glue folders**

```bash
git rm -r src/common/internal-secret src/common/tenancy
git grep -nE "common/internal-secret|common/tenancy|InternalSecretModule|AppTenancyStrategy" -- src
```
Fix every remaining importer (remove the `InternalSecretModule` import from app.module; the tenancy strategy is now inline config). If `src/common/tenancy/tenancy.integration.spec.ts` is worth keeping, relocate it as an app smoke test that imports the lib; otherwise delete it with the folder.

- [ ] **Step 4: Verify enterprise-platform**

```bash
npm run build
npm test
```
Expect: build succeeds; tests pass; `src/common/internal-secret/` and `src/common/tenancy/` no longer exist (`ls` → gone); app boots with `SdCoreModule.forRoot` as the only lib wiring. If something the lib should provide is missing, STOP and report it as a lib gap (a Phase-B follow-up) rather than re-adding app glue.

- [ ] **Step 5: Commit (enterprise-platform repo)**

```bash
git add -A
git commit -m "chore(deps): adopt @sdcorejs/nestjs 1.0.0 — single SdCoreModule.forRoot; drop internal-secret + tenancy glue"
```

---

## Notes on TDD scope

- Phase A is a move/regroup — the existing suite is the safety net (must stay green); new group-API guard tests catch silent `export *` holes that tsc/publint/attw cannot.
- Phase B adds real behavior (provider, adapter, composition) — each gets a failing-first unit test.
- Phase C is integration verification against the real consumer via the vendored tgz — the acceptance is "enterprise-platform builds + tests pass with the two folders gone."
