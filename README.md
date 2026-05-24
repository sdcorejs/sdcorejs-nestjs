# @sdcorejs/nestjs

> Neutral NestJS framework library — Base classes, multi-tenancy, audit, permission, request context, cache, HTTP client, JWT — every domain specific injected via DI strategies. Extracted from `be-masterdata/core-be/` and refactored to be reusable across any NestJS 11 + TypeORM 0.3.x project.

**Status**: `v0.1.0` — preview release. API may change before `v1.0.0`.

## Installation

```bash
npm install @sdcorejs/nestjs
```

Peer dependencies:
- `@nestjs/common` `^11.0.0`
- `@nestjs/core` `^11.0.0`
- `@nestjs/passport` `^11.0.0`
- `typeorm` `^0.3.20`
- `reflect-metadata` `^0.2.0`
- `rxjs` `^7.8`

Engines: `node >=18.18`.

## Sub-paths

| Import | What's inside |
|---|---|
| `@sdcorejs/nestjs` | `SdCoreModule.forRoot({...})` + re-exports |
| `@sdcorejs/nestjs/orm` | `BaseEntity`, `WithTimestamps`, `WithAudit`, `BaseRepository`, `BaseService`, `BaseController`, `@TenantScoped`, `@SearchableFields`, types |
| `@sdcorejs/nestjs/context` | `ContextService` (AsyncLocalStorage-backed), `ContextMiddleware`, header config |
| `@sdcorejs/nestjs/tenancy` | `ITenancyStrategy`, `TENANCY_STRATEGY` token, `@TenantScoped`, helpers |
| `@sdcorejs/nestjs/audit` | `IAuditStrategy`, `AUDIT_STRATEGY`, `AuditSubscriber`, `DefaultAuditStrategy` |
| `@sdcorejs/nestjs/permission` | `IPermissionStrategy`, `AuthGuard`, `@HasPermission`, `@HasAnyPermission` |
| `@sdcorejs/nestjs/cache` | `CacheService`, `CacheInterceptor`, `@Cached` |
| `@sdcorejs/nestjs/http` | `HttpService` (axios-based, context-aware) |
| `@sdcorejs/nestjs/jwt` | `JwtModule`, `JwtStrategy` (passport) |

## Quick start

> Full usage examples per sub-path will land in Phase 13 of the initial extraction plan. For now, see `.sdcorejs/specs/nestjs/` for the design contract and `.sdcorejs/plans/nestjs/` for the implementation plan.

## Philosophy

- **Fully neutral** — no `tenantCode`/`departmentCode` hardcoded; consumer chooses column names via `@TenantScoped()` and writes own `ITenancyStrategy`.
- **No prototype pollution** — no `String.isUuid()` or `Array.prototype.distinct()`; use exported helpers `isUuid(v)`, `unique(arr)`, `propertyOf(key)`.
- **TypeORM 0.3.x bound** — no ORM abstraction; the lib leans into TypeORM features.
- **TDD + 90%+ coverage** — every PR ships with tests; release blocked under threshold.
- **Dual ESM + CJS** — `exports` field maps both formats per sub-path.

## License

[MIT](./LICENSE) © 2026 Trần Thuận Nghĩa
