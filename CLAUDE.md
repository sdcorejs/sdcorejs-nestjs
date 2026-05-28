# @sdcorejs/nestjs — Claude Code Instructions

Neutral NestJS framework library. Base classes + cross-cutting concerns (multi-tenancy, audit, permission, request context, cache, HTTP client, JWT, Zod validation) with **every domain specific injected via DI strategies**. Extracted from `be-masterdata/core-be/` and refactored to be reusable across any NestJS 11 + TypeORM 0.3.x project.

**Status**: `v0.1.0` preview — API may change before `v1.0.0`.

## What this repo is (and is NOT)

- IS: a publishable npm library (`@sdcorejs/nestjs`). Consumers are other NestJS apps.
- IS NOT: an application. No bootstrap, no `main.ts`, no domain entities (`tenantCode`/`departmentCode` etc. are forbidden — see Neutrality below).

## Architecture

Mono-package, **multiple entry points**. Each concern is one folder under `src/` with its own `index.ts` barrel, exposed as a package sub-path via the `exports` map in `package.json`. `SdCoreModule.forRoot({...})` ([src/sd-core.module.ts](src/sd-core.module.ts)) composes every sub-module's `forRoot`; omitted keys fall back to no-op/default strategies. JWT is opt-in (only wired when `jwt` option present).

### Sub-paths

| Import | Folder | Surface |
|---|---|---|
| `@sdcorejs/nestjs` | [src/index.ts](src/index.ts) | `SdCoreModule.forRoot()` + ergonomic re-exports |
| `@sdcorejs/nestjs/orm` | [src/orm/](src/orm/) | `BaseEntity`, `WithTimestamps`/`WithAudit` mixins, `BaseRepository`, `BaseService`, `BaseController`, `@TenantScoped`, `@SearchableFields`, `@Schema`, `apiError`/`ApiResponse` |
| `@sdcorejs/nestjs/context` | [src/context/](src/context/) | `ContextService` (AsyncLocalStorage), `ContextMiddleware`, header config |
| `@sdcorejs/nestjs/tenancy` | [src/tenancy/](src/tenancy/) | `ITenancyStrategy`, `TENANCY_STRATEGY`, `DefaultTenancyStrategy`, helpers |
| `@sdcorejs/nestjs/audit` | [src/audit/](src/audit/) | `IAuditStrategy`, `AUDIT_STRATEGY`, `AuditSubscriber`, `DefaultAuditStrategy` |
| `@sdcorejs/nestjs/permission` | [src/permission/](src/permission/) | `IPermissionStrategy`, `AuthGuard`, `InternalGuard`, `@HasPermission`, `@HasAnyPermission` |
| `@sdcorejs/nestjs/cache` | [src/cache/](src/cache/) | `CacheService`, `CacheInterceptor`, `@Cached`, memory + redis backends |
| `@sdcorejs/nestjs/http` | [src/http/](src/http/) | `HttpService` (axios, context-aware) |
| `@sdcorejs/nestjs/jwt` | [src/jwt/](src/jwt/) | `JwtModule`, `JwtStrategy` (passport-jwt) |
| `@sdcorejs/nestjs/validation` | [src/validation/](src/validation/) | `ZodValidationGuard(schema, source)`, `parseZod(schema, payload)`, `ZodIssueDetail` |

Adding a sub-path requires editing **four** files in lockstep:
1. `src/<name>/index.ts` — barrel.
2. `tsup.config.ts` — add `'<name>/index': 'src/<name>/index.ts'` to `entryMap`.
3. `tsconfig.json` — add `"@sdcorejs/nestjs/<name>": ["src/<name>/index.ts"]` to `paths`.
4. `package.json` — add the `"./<name>"` entry to `exports` (types/import/require triple).

## Core principles

- **Fully neutral.** No domain column names baked in. Consumers pick columns via `@TenantScoped('orgId')` and supply their own `ITenancyStrategy`/`IAuditStrategy`/`IPermissionStrategy`. Never reintroduce `tenantCode`/`departmentCode`.
- **No prototype pollution.** No `String.isUuid()` / `Array.prototype.distinct()`. Use exported helpers (`isUuid`, `unique`, `propertyOf`) from `src/utils/`.
- **TypeORM 0.3.x bound.** No ORM abstraction layer — lean into TypeORM directly.
- **Strategies are DI tokens, not subclassing.** Each concern defines an interface + a `*_STRATEGY` symbol token + a `Default*Strategy` no-op fallback.
- **Bilingual errors.** Throw with i18n **codes**, not literal sentences. The consumer's i18n layer maps `code` + `data`. Validation issues carry the Zod message (set it to an i18n code in your schema) — see [src/validation/zod.utils.ts](src/validation/zod.utils.ts).
- **TDD, high coverage.** Every behavior ships with a `*.spec.ts` next to it. Release is blocked under the coverage threshold.
- **Dual ESM + CJS.** `tsup` emits both (`.mjs`/`.cjs`); `tsc` emits `.d.ts`. The `exports` map wires all three per sub-path.

## Optional peer dependencies pattern

Heavy/optional backends are **lazy-`require`d**, never top-level `import`ed, so the package installs without them:

- `ioredis` (redis cache backend) — see [src/cache/backends/redis-cache.backend.ts](src/cache/backends/redis-cache.backend.ts). `require('ioredis')` inside a try/catch; on failure `CacheService` auto-falls back to memory (opt out with `fallbackToMemory: false`).
- `zod` (validation) — typed via `import type` only at the boundary.

Both are declared as `peerDependencies` + `peerDependenciesMeta.<pkg>.optional = true`, and `external` in `tsup.config.ts`.

> ⚠️ **Do NOT add `ioredis` to `devDependencies`.** The cache fallback tests (`cache.service.spec.ts` — "auto-falls back to memory when 'ioredis' is missing", "fallbackToMemory=false rethrows") assert the **absent** path. Installing `ioredis` makes `require()` succeed and breaks those two tests. `zod` IS a devDependency because the validation tests need a real schema and zod has no absent-path test.

## Commands

```bash
npm test                # jest, all specs
npm test -- src/<area>  # one area, e.g. src/validation
npm run test:coverage   # with coverage gate
npm run lint            # eslint . --ext .ts
npm run build           # tsup (bundle) + tsc (types) → dist/{esm,cjs,types}
```

The branch-ready gate is: `npm test` green + `npm run lint` clean + `npm run build` succeeds.

> Known pre-existing lint debt: [src/cache/backends/redis-cache.backend.ts:45](src/cache/backends/redis-cache.backend.ts#L45) unused `catch (e)` binding (1 error). Unrelated to other areas.

## Gotchas

- **Express 5 read-only `req.query`/`req.params`.** `ZodValidationGuard` mutates query/params **in place** (delete keys + `Object.assign`) instead of reassigning, because Express 5 makes them getter-only. `req.body` is freely reassignable. See [src/validation/zod-validation.guard.ts](src/validation/zod-validation.guard.ts).
- **Guard order.** Place `ZodValidationGuard` AFTER `AuthGuard`: `@UseGuards(AuthGuard, ZodValidationGuard(schema))` — unauthenticated requests must not reach validation.
- **`apiError` envelope.** Errors use `apiError(code, message, data?)` from `src/orm/types/api-response.types.ts`. Validation failures throw `BadRequestException(apiError('core.validation.failed', 'Validation failed', { issues }))`.

## Reference docs

- [README.md](README.md) — public-facing overview + install.
- [docs/migration-from-core-be.md](docs/migration-from-core-be.md) — mapping from the original `be-masterdata/core-be`.
- `.sdcorejs/specs/nestjs/` + `.sdcorejs/plans/nestjs/` — design contract + implementation plan for the extraction.
