# Spec — Bóc tách `@sdcorejs/nestjs` từ `be-masterdata/core-be/` — 2026-05-21 10:00

## Problem & Goals

Hệ sinh thái SDCoreJS đang sở hữu một lớp backend dùng chung (`be-masterdata/base/core-be/`) gồm Base Entity/Repository/Service/Controller, multi-tenancy, audit, permission, JWT, cache và HTTP client. Code này hiện chỉ phục vụ riêng `be-masterdata`: hardcode tên cột `tenantCode`/`departmentCode`, phụ thuộc một loạt package nội bộ `@shared/*`, ô nhiễm `String.prototype` / `Object.prototype` / `Array.prototype`, và trộn lẫn các module domain (action-history, masterdata/employee, page-permission, …). Vì vậy nó không thể publish lên npm để các dự án anh em hoặc cộng đồng dùng lại.

Mục tiêu: extract phần "framework" thành thư viện `@sdcorejs/nestjs` được publish trên npm public, **hoàn toàn neutral** — mọi đặc thù (multi-tenancy, audit, permission, header names) đều trừu tượng thành interface + DI token; consumer cung cấp implementation lúc bootstrap qua `SdCoreModule.forRoot({...})`. Sau khi release `v0.1.0` (preview), `be-masterdata` sẽ migrate dần dần và thư viện chạy production ổn 1 tháng trước khi bump `v1.0.0`.

Thành công khi:
1. `npm install @sdcorejs/nestjs` từ một dự án NestJS 11 trống → `SdCoreModule.forRoot({...})` boot không lỗi.
2. Một consumer KHÔNG-phải-SD có thể implement 3 strategies (`ITenancyStrategy`, `IAuditStrategy`, `IPermissionStrategy`) bằng schema của họ mà KHÔNG cần fork code lib.
3. `be-masterdata` có thể adopt lib này bằng cách viết 3 strategies SD-specific + register qua `forRoot()`, không phải sửa code của lib.

## Non-goals

- **Không publish các module domain** — `modules/action-history`, `modules/masterdata/*`, `modules/admin/user`, `modules/page-permission`, `modules/static-report`, `modules/form-definition` giữ nguyên trong `be-masterdata`. Lib chỉ publish "framework", không phải "business".
- **Không abstract ORM layer** — lib coupling cứng với TypeORM `^0.3.20`. Không hỗ trợ Prisma / Mikro-ORM / raw SQL ở vòng 1.
- **Không support NestJS 10** — peer-dep chỉ `^11.0.0`. Consumer Nest 10 phải upgrade.
- **Không gồm ActionHistory abstraction / FileStorage drivers / JobScheduler** — defer vòng 2+ sau khi API các module khác đã ổn định.
- **Không sửa code `be-masterdata`** trong scope task này — `be-masterdata` chỉ là consumer tham chiếu để verify, migration của nó là task riêng.
- **Không cung cấp GraphQL / gRPC controllers** — vòng 1 chỉ REST.
- **Không auto-generate OpenAPI** — consumer tự wire `@nestjs/swagger`.
- **Không cung cấp i18n message resolver** — error message bilingual `{ vi, en }` là pass-through.

## Architecture

### Triết lý

Lib chia thành 3 lớp:

1. **Core** (`root` + `/orm` + `/context`): nền tảng không thể tách. `BaseEntity` minimal, `BaseRepository<T>` với filter/sort/paging neutral, `ContextService` injectable thay cho `SdContext` static cũ.
2. **Strategy-driven concerns** (`/tenancy` + `/audit` + `/permission`): mỗi module có 1 interface (DI token) + default no-op/sample strategy + decorator/mixin để consumer mark entity. Repository/Subscriber/Guard đọc strategy qua DI, KHÔNG hardcode field name nào.
3. **Utility modules** (`/cache` + `/http` + `/jwt`): các tiện ích lập trình hệ thống, ít opinion về domain.

### Tổ chức package

Mono-package `@sdcorejs/nestjs` với **8 subpath entries** khai báo trong `package.json#exports`. Mỗi sub-path là một entry-point độc lập, dùng `tsup` build dual ESM + CJS với multi-entry:

| Sub-path | Nội dung |
|---|---|
| `@sdcorejs/nestjs` | `SdCoreModule.forRoot({...})`, re-export các module con |
| `@sdcorejs/nestjs/orm` | `BaseEntity`, `WithTimestamps`, `WithAudit`, `BaseRepository`, `BaseService`, `BaseController`, `@TenantScoped`, `@SearchableFields`, `SdFilter`, `SdPagingReq/Res`, `SdOrder` |
| `@sdcorejs/nestjs/context` | `ContextModule`, `ContextService`, `ContextMiddleware`, `RequestContext` interface, `CONTEXT_HEADERS_CONFIG` token |
| `@sdcorejs/nestjs/tenancy` | `TenancyModule`, `ITenancyStrategy`, `TENANCY_STRATEGY` token, `@TenantScoped` decorator, `getScopedColumns()` helper, `DefaultTenancyStrategy` (no-op). Enforcement nằm trong `BaseRepository` — đọc `@TenantScoped` metadata + strategy → inject filter ở mọi read + auto-fill ở create. KHÔNG có Interceptor riêng. |
| `@sdcorejs/nestjs/audit` | `AuditModule`, `AuditSubscriber`, `IAuditStrategy`, `AUDIT_STRATEGY` token, `DefaultAuditStrategy` |
| `@sdcorejs/nestjs/permission` | `PermissionModule`, `AuthGuard`, `@HasPermission`, `@HasAnyPermission`, `IPermissionStrategy`, `PERMISSION_STRATEGY` token |
| `@sdcorejs/nestjs/cache` | `CacheModule`, `CacheService`, `CacheInterceptor`, `@Cached`, `RequestCacheMiddleware` |
| `@sdcorejs/nestjs/http` | `HttpClientModule`, `HttpService` (axios-based) |
| `@sdcorejs/nestjs/jwt` | `JwtModule`, `JwtStrategy` (passport) |

### Strategy contracts

**`ITenancyStrategy`** (decorator-based):
```ts
interface ITenancyStrategy {
  getCurrentScope(ctx: RequestContext): Record<string, unknown>; // ví dụ: { tenantCode: 'ABC', departmentCode: 'D1' }
  shouldBypass(ctx: RequestContext): boolean;                    // SYSTEM_ADMIN, internal call, ...
}
```
Consumer mark column entity với `@TenantScoped() tenantCode: string`. `BaseRepository` là single point of enforcement — đọc metadata + gọi `getCurrentScope()` → inject filter `EQUAL` cho mọi method read (`paging/all/search/detail`); `BaseRepository.create()` + `.import()` đọc metadata + auto-fill cùng giá trị nếu `!shouldBypass(ctx)`. **Nếu consumer KHÔNG register strategy → repository hành xử như không có tenancy** (zero overhead, zero magic). KHÔNG có Interceptor riêng.

**`IAuditStrategy`** (split mixin):
```ts
interface IAuditStrategy {
  onCreate(entity: any, ctx: RequestContext): void;
  onUpdate(entity: any, ctx: RequestContext): void;
  onSoftDelete(entity: any, ctx: RequestContext): void;
}
```
2 mixin riêng để consumer chọn level:
- `WithTimestamps(BaseEntity)` → adds `createdAt`, `updatedAt`, `deletedAt` (TypeORM tự sinh, không cần strategy).
- `WithAudit(BaseEntity)` = `WithTimestamps` + `createdBy`, `modifiedBy`, `creator: UserSnapshot`, `modifier: UserSnapshot`.

Lib cung cấp `DefaultAuditStrategy` đọc `ctx.userId` + `ctx.user` từ `ContextService` để fill. `AuditSubscriber` là TypeORM subscriber, gọi strategy ở `beforeInsert/beforeUpdate/beforeSoftRemove` — và chỉ khi entity có mixin `WithAudit` (detect qua metadata).

**`IPermissionStrategy`** (string code, neutral):
```ts
interface IPermissionStrategy {
  load(ctx: RequestContext): Promise<string[]>;       // user permission codes
  check?(codes: string[], required: string): boolean; // default: codes.includes(required)
}
```
Decorator dùng string code, không ràng vào type:
```ts
@HasPermission('product:create')
@HasAnyPermission('product:create', 'product:update')
```
`AuthGuard` extends `PassportAuthGuard('jwt')`, load codes 1 lần / request rồi cache lên `request.permissions`, check theo decorator metadata. Convention `resource:action` chỉ là khuyến nghị, lib không enforce.

### Context — replace static `SdContext` + `cls-hooked`

`ContextService` là class injectable (lazy singleton + ALS namespace), thay cho `SdContext` static cũ:
- `ContextMiddleware` mỗi request: tạo store object, `AsyncLocalStorage.run(store, next)`.
- `ContextService.get<K extends keyof RequestContext>(key: K)` → giá trị từ store.
- Header names config qua `forRoot({ context: { headers: { tenantCode: 'X-Tenant-Code', userId: 'X-User-Id', ... } } })`. Default giữ giống `be-masterdata` (`X-Tenant-Code`, `X-Department-Code`, `X-Project`, `X-Internal-Secret`, `X-User-Id`, `X-Username`, `X-Full-Name`, `accept-language`, `x-language`) để migrate êm.

Tại sao `AsyncLocalStorage` thay `cls-hooked`:
- `cls-hooked` đã không maintain tích cực; `AsyncLocalStorage` là native Node `async_hooks` API, Node >= 14.
- `AsyncLocalStorage` xử lý `await`/`Promise` chains tốt hơn, không có "leak across requests" bug từng có với cls-hooked.

### Drop `@shared/*` dependencies + bỏ prototype pollution

Lib KHÔNG phép import từ `@shared/typing`, `@shared/admin`, `@shared/auth`, `@shared/core`, `@shared/common`, `@shared/entity`. Tất cả types cần thiết được inline lại:
- `SdFilter`, `SdOrder`, `SdPagingReq`, `SdPagingRes`, `SdFilterAndOr` → `src/orm/types/`
- `UserSnapshot` (jsonb shape) → `src/audit/types/` (interface tối thiểu: `{ id: string; username: string; fullName: string }`, consumer mở rộng được qua generic nếu cần)
- `RequestContext` → `src/context/types/`
- `Dto` (entity DTO marker) → `src/orm/types/`
- `ActionHistoryType` enum → bỏ (theo defer ActionHistory)

Prototype pollution bị bỏ hoàn toàn:
- `String.isUuid(v)` → `import { isUuid } from '@sdcorejs/nestjs/orm'` hoặc `/utils`
- `Array.prototype.distinct()` → `unique<T>(arr: T[]): T[]`
- `Object.propertyOf<T>(key)` → `propertyOf<T>(key: keyof T): string`

### Search method — decorator-based

`BaseRepository.search(keyword, filters)` hiện hardcode:
```ts
const exactFields   = ['code', 'username', 'value'];
const containFields = ['name', 'fullName', 'display'];
const hasActivated  = hasCol('isActivated');
```

→ thay bằng decorator:
```ts
@SearchableFields({
  exact: ['code', 'sku'],
  contain: ['name', 'description'],
  activeColumn: 'isActive', // optional
})
@Entity()
class Product extends WithAudit(BaseEntity) { ... }
```
`search()` đọc metadata; nếu entity không có `@SearchableFields()` → trả mảng rỗng / `[]` (không infer field names "ma thuật").

### Build, tests, CI

- **Build**: `tsc -p tsconfig.build.json` emit declarations vào `dist/types/`. `tsup` config với 8 entries, mỗi entry build dual `dist/esm/<sub>.mjs` + `dist/cjs/<sub>.cjs`. `package.json#exports` trỏ đúng cặp.
- **Tests**: Jest. Unit + integration (pg-mem cho TypeORM tests). TDD-first: viết failing tests từ acceptance criteria trước, implement sau. Coverage threshold 90% lines/branches trên `src/`.
- **CI** (GitHub Actions):
  - `ci.yml`: matrix Node 18.18 + 20.x, chạy lint + test + build trên push & PR.
  - `release.yml`: chỉ chạy khi tag `v*` được push, dùng `NPM_TOKEN` từ secret để publish.
- **Versioning**: [Changesets](https://github.com/changesets/changesets). Mỗi PR phải có `.changeset/<random>.md`. Release tự động sinh CHANGELOG.md và bump version.

## File structure

Liệt kê file cần tạo/sửa, theo nhóm. (Plan giai đoạn sau sẽ chia file-by-file order; spec này chỉ liệt kê thô.)

### Repo root
```
package.json                   → name, version 0.1.0, license MIT, exports field (8 entries), peer-deps
tsconfig.json                  → base config (strict: true, target ES2022)
tsconfig.build.json            → emit only src/, exclude tests
tsup.config.ts                 → multi-entry build dual ESM+CJS
jest.config.ts                 → preset ts-jest, coverage threshold 90%
.eslintrc.cjs                  → typescript-eslint + nestjs rules
.prettierrc                    → match be-masterdata style
.gitignore                     → node_modules, dist, coverage
.npmignore                     → only ship dist/ + README + LICENSE + CHANGELOG
.changeset/config.json         → Changesets config
.github/workflows/ci.yml       → build+lint+test matrix
.github/workflows/release.yml  → npm publish on tag v*
README.md                      → overview + per-sub-path usage examples
CHANGELOG.md                   → empty initially, Changesets-managed
LICENSE                        → MIT (đã có)
```

### `src/` — source

```
src/
├── index.ts                              → root barrel
├── sd-core.module.ts                     → SdCoreModule.forRoot()
│
├── orm/
│   ├── index.ts                          → barrel
│   ├── base-entity.ts                    → BaseEntity (id only)
│   ├── mixins/
│   │   ├── with-timestamps.ts            → mixin factory
│   │   └── with-audit.ts                 → mixin = timestamps + audit user fields
│   ├── base-repository.ts                → BaseRepository<T>, paging/filter/sort/CUD
│   ├── base-service.ts                   → BaseService<T,Dto>
│   ├── base-controller.ts                → BaseController<T,Dto>
│   ├── decorators/
│   │   ├── tenant-scoped.decorator.ts    → @TenantScoped()
│   │   ├── searchable-fields.decorator.ts→ @SearchableFields({ exact, contain, activeColumn })
│   │   └── schema.decorator.ts           → @Schema, @SchemaProp (chuyển từ core-be/decorators/)
│   ├── types/
│   │   ├── filter.types.ts               → SdFilter, SdFilterAndOr, SdOrder
│   │   ├── paging.types.ts               → SdPagingReq, SdPagingRes
│   │   ├── repository-args.types.ts      → BaseRepositoryArgs
│   │   ├── dto.types.ts                  → Dto marker interface
│   │   └── api-response.types.ts         → ApiResponse helper
│   └── utils/
│       └── filter-query-builder.ts       → internal: resolve column / apply filter to QB
│
├── context/
│   ├── index.ts
│   ├── context.module.ts                 → ContextModule (registers middleware)
│   ├── context.service.ts                → ContextService (ALS-backed)
│   ├── context.middleware.ts             → ContextMiddleware (sets ALS store)
│   ├── context.types.ts                  → RequestContext interface
│   └── tokens.ts                         → CONTEXT_HEADERS_CONFIG token
│
├── tenancy/
│   ├── index.ts                          → barrel; re-exports @TenantScoped from /orm/decorators for ergonomics
│   ├── tenancy.module.ts
│   ├── tenancy.helpers.ts                → getScopedColumns(entityClass), applyScopeToEntity(entity, scope), buildScopeFilters(scope) — used internally by BaseRepository
│   ├── default-tenancy.strategy.ts       → no-op default
│   ├── strategy.interface.ts             → ITenancyStrategy
│   └── tokens.ts                         → TENANCY_STRATEGY
│
├── audit/
│   ├── index.ts
│   ├── audit.module.ts
│   ├── audit.subscriber.ts               → TypeORM subscriber
│   ├── default-audit.strategy.ts         → reads ctx, fills audit fields
│   ├── strategy.interface.ts             → IAuditStrategy
│   ├── types.ts                          → UserSnapshot interface
│   └── tokens.ts                         → AUDIT_STRATEGY
│
├── permission/
│   ├── index.ts
│   ├── permission.module.ts
│   ├── auth.guard.ts                     → extends PassportAuthGuard('jwt')
│   ├── decorators/
│   │   ├── has-permission.decorator.ts   → @HasPermission(code)
│   │   └── has-any-permission.decorator.ts→ @HasAnyPermission(...codes)
│   ├── default-permission.strategy.ts
│   ├── strategy.interface.ts             → IPermissionStrategy
│   └── tokens.ts                         → PERMISSION_STRATEGY
│
├── cache/
│   ├── index.ts
│   ├── cache.module.ts
│   ├── cache.service.ts                  → in-memory + optional Redis backend
│   ├── cache.interceptor.ts
│   ├── request-cache.middleware.ts
│   ├── decorators/
│   │   └── cached.decorator.ts
│   └── types.ts
│
├── http/
│   ├── index.ts
│   ├── http.module.ts                    → HttpClientModule.forRoot()
│   ├── http.service.ts                   → axios wrapper, propagates context headers
│   └── types.ts
│
├── jwt/
│   ├── index.ts
│   ├── jwt.module.ts                     → JwtModule.forRoot({ secret, ... })
│   └── jwt.strategy.ts                   → passport JWT strategy
│
└── utils/
    ├── index.ts                          → barrel for cross-module helpers
    ├── uuid.ts                           → isUuid(value): boolean
    ├── array.ts                          → unique<T>(arr), distinct<T>(arr)
    ├── object.ts                         → propertyOf<T>(key)
    └── string.ts                         → kebab-case, snake-case, ...
```

### `test/` — tests

```
test/
├── unit/                                 → unit tests per file (co-located also acceptable, TBD in plan)
├── integration/
│   ├── orm/
│   │   ├── base-repository.paging.int-spec.ts
│   │   ├── base-repository.filters.int-spec.ts          → AND/OR/IN/BETWEEN/CONTAIN/JSON path/relation
│   │   ├── base-repository.cud.int-spec.ts              → create/update/softDelete/restore/import
│   │   └── base-repository.search.int-spec.ts          → @SearchableFields metadata
│   ├── tenancy/tenancy.int-spec.ts                     → scope filter inject + bypass
│   ├── audit/audit.int-spec.ts                         → subscriber fires for WithAudit only
│   ├── permission/auth-guard.int-spec.ts
│   └── context/context.int-spec.ts                     → ALS preservation across awaits
├── e2e/
│   └── consumer-app.e2e-spec.ts                        → fake NestJS app uses SdCoreModule.forRoot, runs paging+create end-to-end
└── fixtures/
    ├── sample-entity.ts
    ├── sample-tenancy-entity.ts                        → @TenantScoped columns
    ├── sample-audit-entity.ts                          → WithAudit(BaseEntity)
    └── pg-mem-datasource.ts
```

## Acceptance criteria

### Package metadata
- [ ] `package.json#name` = `"@sdcorejs/nestjs"`, `version` = `"0.1.0"`, `license` = `"MIT"`
- [ ] `package.json#exports` declares 8 subpath entries with both `import` (ESM) và `require` (CJS) + `types`
- [ ] Peer-deps: `@nestjs/common ^11.0.0`, `@nestjs/core ^11.0.0`, `@nestjs/passport ^11.0.0`, `typeorm ^0.3.20`, `reflect-metadata ^0.2.0`, `rxjs ^7.8`
- [ ] `engines.node` = `">=18.18"`
- [ ] `npm pack --dry-run` ships `dist/` + `README.md` + `LICENSE` + `CHANGELOG.md`, KHÔNG ship `src/`, `test/`, `coverage/`, `node_modules/`
- [ ] Both ESM (`dist/esm/*.mjs`) + CJS (`dist/cjs/*.cjs`) bundles produced, types ở `dist/types/`

### Root + `/orm`
- [ ] `BaseEntity` chỉ chứa `@PrimaryColumn({ type: 'uuid' }) @Generated('uuid') id: string`
- [ ] `WithTimestamps(BaseEntity)` mixin thêm `createdAt`, `updatedAt`, `deletedAt` qua TypeORM decorators
- [ ] `WithAudit(BaseEntity)` mixin = `WithTimestamps` + `createdBy: string`, `modifiedBy: string`, `creator: UserSnapshot` (jsonb), `modifier: UserSnapshot` (jsonb)
- [ ] `BaseRepository<T>.paging(req, args?)` hỗ trợ filters: `EQUAL`, `NOT_EQUAL`, `LESS_THAN`/`LESS_OR_EQUAL`, `GREATER_THAN`/`GREATER_OR_EQUAL`, `CONTAIN`/`NOT_CONTAIN`/`START_WITH`/`END_WITH`/`NOT_START_WITH`/`NOT_END_WIDTH`, `BETWEEN`, `IN`/`NOT_IN`, `NULL`/`NOT_NULL`, `AND`/`OR` (recursive)
- [ ] Filter parsing reject field names không khớp regex `/^[a-zA-Z0-9_.]+$/` (SQL injection guard)
- [ ] JSON path filter (`attributes.color`) generate đúng SQL: `"attributes" ->> 'color'`
- [ ] Relation filter (`creator.fullName`) join + alias đúng
- [ ] `pageSize` clamp max 1000; `pageNumber` clamp min 0
- [ ] Sorting với `NULLS FIRST` cho ASC, `NULLS LAST` cho DESC (giữ logic cũ)
- [ ] `BaseRepository.create()` gọi `IAuditStrategy.onCreate(entity, ctx)` nếu entity là `WithAudit` và strategy registered; với `WithTimestamps` only thì không gọi
- [ ] `BaseRepository.softDelete(id|ids)` cập nhật `deletedAt`; `paging()` mặc định exclude soft-deleted
- [ ] `BaseRepository.search(keyword, filters)` đọc metadata `@SearchableFields()`; nếu entity không có decorator → trả mảng rỗng (không infer "magic")
- [ ] `BaseRepository.search()` với UUID input → tìm chính xác theo `id`, bỏ qua filters + tenancy
- [ ] `BaseRepository.import()` chunked size 1000, returning `*`, audit fields được gọi cho từng chunk
- [ ] `BaseService<T, Dto>` expose: `paging`, `pagingDeleted`, `all`, `search`, `detail`, `create`, `import`, `update`, `delete`, `softDelete`, `restore`, `mapDTO` (abstract)
- [ ] `BaseController<T, Dto>` expose: `POST /search`, `POST /paging`, `POST /paging/deleted`, `GET /all`, `GET /:id`, `DELETE /:id`, `DELETE /:id/soft`, `PUT /:id/restore`

### `/context`
- [ ] `ContextService` injectable, có DI scope `DEFAULT` (singleton, ALS-backed — không phải REQUEST scope vì gây perf issue khi inject vào singleton service)
- [ ] `ContextMiddleware` chạy ở mọi route: tạo store + `AsyncLocalStorage.run(store, next)`
- [ ] `ContextService.userId`, `.username`, `.fullName`, `.tenantCode`, `.departmentCode`, `.project`, `.lang`, `.token`, `.internalSecret`, `.user`, `.isSystemAdmin`, `.isTenantAdmin`, `.permissions`, `.hasPermission(code)` accessors
- [ ] Header names override-able qua `SdCoreModule.forRoot({ context: { headers: { tenantCode: 'X-Org-Id', ... } } })`; default = bộ header của `be-masterdata`
- [ ] Test: context preserved across `await`/`Promise.all`/nested function call chains
- [ ] No `cls-hooked` dependency anywhere in `package.json` hoặc source

### `/tenancy`
- [ ] `@TenantScoped()` column decorator gắn metadata `sdcore:tenant:scoped` lên property
- [ ] `tenancy.helpers.getScopedColumns(entityClass)` trả về danh sách tên cột đã decorate
- [ ] `BaseRepository.paging()` + `.all()` + `.search()` + `.detail()` tự inject filter `EQUAL` cho mỗi `@TenantScoped` column với value từ `ITenancyStrategy.getCurrentScope()`, trừ khi `shouldBypass(ctx) === true`
- [ ] `BaseRepository.create()` + `.import()` tự fill `@TenantScoped` columns từ `getCurrentScope()` trừ khi `shouldBypass(ctx) === true`
- [ ] `shouldBypass(ctx) === true` → repository KHÔNG inject filter, KHÔNG auto-fill column
- [ ] Strategy KHÔNG registered → repository hành xử như tenancy disabled: không lookup metadata, không inject filter (zero overhead)
- [ ] No `TenancyInterceptor` exists — enforcement chỉ ở `BaseRepository` (single point)
- [ ] Test: 2 consumer entities, 1 có `@TenantScoped`, 1 không — chỉ entity đầu bị scoped

### `/audit`
- [ ] `AuditSubscriber` register tự động khi `AuditModule` được import
- [ ] Subscriber fire `IAuditStrategy.onCreate(entity, ctx)` ở `beforeInsert` chỉ khi entity là `WithAudit` (detect qua metadata, không phải `instanceof` vì mixin)
- [ ] Subscriber fire `onUpdate(entity, ctx)` ở `beforeUpdate`
- [ ] Subscriber fire `onSoftDelete(entity, ctx)` ở `beforeSoftRemove`
- [ ] `DefaultAuditStrategy` đọc `ctx.userId` + `ctx.user` → set `createdBy/modifiedBy/creator/modifier`; nếu `ctx.userId` undefined → skip (không throw, không set bừa)
- [ ] Consumer override `forRoot({ audit: { strategy: MyAuditStrategy } })` → `DefaultAuditStrategy` bị replace
- [ ] Test: bulk `BaseRepository.import()` cũng fill audit fields cho từng entity (subscriber có thể không trigger với raw insert query → repository tự gọi strategy)

### `/permission`
- [ ] `@HasPermission('product:create')` set metadata key `sdcore:permission:any` với value `['product:create']`
- [ ] `@HasAnyPermission('product:create', 'product:update')` set cùng key với 2 codes; AuthGuard check OR
- [ ] `AuthGuard` extends `PassportAuthGuard('jwt')`; sau auth thành công, gọi `IPermissionStrategy.load(ctx)` 1 lần, cache vào `request.permissions`
- [ ] Default `check(codes, required) = codes.includes(required)`; consumer override qua `forRoot({ permission: { strategy: MyPermStrategy } })` để custom (ví dụ wildcard `product:*`)
- [ ] Endpoint không có `@HasPermission` → pass (chỉ check auth)
- [ ] Check fail → 403 với `{ vi: 'Bạn không có quyền thực hiện hành động này', en: 'You do not have permission to perform this action' }`

### `/cache`
- [ ] `@Cached({ ttl: 60 })` interceptor cache return value theo key `<methodPath>:<argsHash>:<tenantScopeHash>`
- [ ] In-memory backend mặc định (LRU); Redis backend opt-in qua `CacheModule.forRoot({ backend: 'redis', ... })`
- [ ] `CacheService.get/set/del/clear`
- [ ] Tenancy-aware: cache key incorporate tenant scope khi `ITenancyStrategy` registered

### `/http`
- [ ] `HttpService.get<T>/post/put/delete/patch` axios-based, returns `Promise<T>`
- [ ] Tự động propagate context headers (tenantCode, userId, ...) khi call outbound
- [ ] Timeout, retries config qua `HttpClientModule.forRoot()`

### `/jwt`
- [ ] `JwtModule.forRoot({ secret, expiresIn, issuer, audience })` configures passport JWT strategy
- [ ] `JwtStrategy` extracts token from `Authorization: Bearer <token>`; supports cookie fallback nếu config

### Utils
- [ ] `isUuid(value: unknown): value is string` — đúng cho v1-v5 UUID format
- [ ] `unique<T>(arr: T[]): T[]` — preserve order
- [ ] `propertyOf<T>(key: keyof T): string` — type-safe property name
- [ ] No `String.prototype`/`Array.prototype`/`Object.prototype` mutation anywhere in source

### Build + tests + CI
- [ ] `npm run build` produces `dist/esm/`, `dist/cjs/`, `dist/types/` cho tất cả 8 entries
- [ ] `npm run test` passes Jest with coverage `>=90%` lines + branches trên `src/**`
- [ ] `npm run lint` zero errors
- [ ] `npm run test:e2e` consumer-app end-to-end test passes (real NestJS app boots, GET paging works)
- [ ] CI workflow chạy trên push + PR, fail nếu lint/test/build/coverage fail
- [ ] Release workflow publish npm trên tag `v*` dùng `NPM_TOKEN`
- [ ] Mọi PR phải có `.changeset/<random>.md` (enforce qua CI)

### Migration / sanity check
- [ ] Sample integration test trong `test/e2e/consumer-app.e2e-spec.ts` demonstrate: fake NestJS app importing `SdCoreModule.forRoot()` + register 3 strategies + booting paging+create+update+softDelete against pg-mem
- [ ] README có section "Migration from `be-masterdata/core-be`" với checklist cho `be-masterdata` team
- [ ] `npm install @sdcorejs/nestjs@0.1.0` từ fresh Nest 11 project + minimal `forRoot()` boot không runtime error
- [ ] (Defer ra task riêng) `be-masterdata` viết SdTenancyStrategy/SdAuditStrategy/SdPermissionStrategy SD-specific, swap `core-be/` import sang `@sdcorejs/nestjs/*`, build pass — KHÔNG trong scope task này, chỉ verify lib đủ API surface

## Risks & mitigations

- **Risk**: Strip `@shared/*` dependencies có thể surface coupling chưa thấy → **Mitigation**: scan tất cả `import` trong `core-be/`, list types cần inline, port từng sub-path theo thứ tự `/orm` → `/context` → strategies → utility, fix typecheck error iteratively.
- **Risk**: `cls-hooked` → `AsyncLocalStorage` có thể hành xử khác ở nested async chains → **Mitigation**: integration test bắt buộc cho `Promise.all`, nested `await`, `setImmediate`, `setTimeout` chains; document min Node version (`>=18.18` hỗ trợ ALS đầy đủ).
- **Risk**: TypeORM subscribers không trigger với bulk insert `qb.insert().values()` (cách `BaseRepository.import()` đang dùng) → **Mitigation**: `BaseRepository.import()` tự gọi `IAuditStrategy.onCreate()` trước khi insert; integration test verify subscriber + import path cả 2 đều fill audit fields.
- **Risk**: Mixin pattern với TypeORM decorators có thể fragile (metadata không inherit qua mixin function call) → **Mitigation**: prototype mixin với real TypeORM operation ở giai đoạn đầu plan; nếu metadata bị mất → fallback sang abstract class hierarchy với conditional decorators (vẫn neutral được, chỉ là API consumer xấu hơn).
- **Risk**: Tree-shaking không hoàn hảo với NestJS DI metadata → bundle size lib lớn → **Mitigation**: NestJS chủ yếu chạy server, bundle size không phải vấn đề chính như frontend; chấp nhận tradeoff. Mỗi sub-path tự barrel, consumer import đúng đường dẫn cần dùng.
- **Risk**: API `v0.1.0` có thể có bug tinh vi block `be-masterdata` migration → **Mitigation**: explicit "preview" label trong README + npm dist-tag; iterate `v0.x` cho đến khi `be-masterdata` migrate xong; `v1.0.0` chỉ release sau 1 tháng production stable.
- **Risk**: `Reflect.getMetadata` + decorator inheritance đôi khi không hoạt động như mong đợi với mixin → **Mitigation**: bọc mixin trong helper utility, test metadata propagation thoroughly trước khi commit `BaseEntity` interface.
- **Risk**: `npm` org `@sdcorejs` có thể chưa được tạo / đã có người chiếm → **Mitigation**: verify ngay khi bắt đầu phase plan; nếu mất scope → đổi sang `@sdcore-js` hoặc tương tự, communicate trước khi locked vào tên.

## Out of scope (deferred)

- **ActionHistory abstraction** — defer cho đến khi `be-masterdata` + 1 consumer thứ 2 cùng có nhu cầu, converge được interface shape thực tế.
- **FileStorage drivers** (Local + S3) — defer cho đến khi ít nhất 2 consumer commit dùng abstraction; thêm vào `v0.2.x`.
- **JobScheduler module** — defer cho đến khi pattern cron job ổn định + ít nhất 1 consumer dùng.
- **NestJS 10 support** — defer cho đến khi có yêu cầu cụ thể từ consumer lớn còn kẹt ở Nest 10.
- **GraphQL / gRPC controllers** — defer; vòng 1 chỉ REST.
- **OpenAPI / Swagger auto-generation** — defer; consumer tự wire `@nestjs/swagger`.
- **i18n message resolver** — defer; error message bilingual `{ vi, en }` là pass-through key, consumer tự dịch.
- **Migration TypeORM 0.4+** — defer cho đến khi 0.4 stable; sẽ là `v1.x` breaking change.
- **Sửa code `be-masterdata`** để migrate sang lib mới — defer; task riêng sau khi lib `v0.1.0` publish.
