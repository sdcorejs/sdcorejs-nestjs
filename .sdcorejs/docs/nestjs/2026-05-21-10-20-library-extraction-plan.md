# Plan — Bóc tách `@sdcorejs/nestjs` — 2026-05-21 10:20

> Plan này tương ứng với approved spec [`2026-05-21-10-00-library-extraction-spec.md`](./2026-05-21-10-00-library-extraction-spec.md).
> **Tất cả đường dẫn dưới đây relative từ `c:\Users\Admin\Documents\sdcorejs\sdcorejs-nestjs\`** (target project root).
> **Source tham chiếu read-only**: `c:\Users\Admin\Documents\local-solution\be-masterdata\base\core-be\`
> **TDD bắt buộc**: mỗi phase implement, test file viết TRƯỚC, đảm bảo red → impl → green. Spec → AC → test cases là chuỗi truy vết bắt buộc.

---

## Scope (recap from spec)

Extract `be-masterdata/core-be/` thành thư viện npm `@sdcorejs/nestjs` (mono-package, 8 sub-paths, NestJS 11, TypeORM 0.3.x, dual ESM+CJS). Mọi đặc thù (tenantCode/departmentCode, audit fields, permission shape, header names) trừu tượng qua DI strategies. `BaseEntity` minimal; audit qua mixin `WithAudit`. `BaseRepository` là single point of tenancy enforcement. Drop `@shared/*` deps + prototype pollution. Coverage TDD-first 90%+, CI matrix Node 18.18+20.x, release Changesets + `NPM_TOKEN`. Initial v0.1.0 preview.

## Files to create / edit

### Phase 0 — Bootstrap repo *(no TDD: config-only)*

1. EDIT    `README.md` — overview + installation + per-sub-path usage table skeleton (chi tiết content phase 13)
2. CREATE  `.gitignore` — `node_modules/`, `dist/`, `coverage/`, `.DS_Store`, `*.log`, `.env*`
3. CREATE  `.npmignore` — exclude `src/`, `test/`, `coverage/`, `.changeset/`, `tsconfig*.json`, `*.config.ts`, `.github/`, `.eslint*`, `.prettier*`
4. CREATE  `package.json` — `name: "@sdcorejs/nestjs"`, `version: "0.1.0"`, `license: "MIT"`, `engines.node: ">=18.18"`, `exports` field (8 sub-paths, dual import/require), peer-deps (NestJS 11, TypeORM 0.3.20, passport, reflect-metadata, rxjs), dev-deps (tsup, tsc, jest, ts-jest, eslint, prettier, @types/*, pg-mem, supertest, @nestjs/testing), scripts (`build`, `test`, `test:e2e`, `lint`, `lint:fix`, `format`, `release`, `changeset`)
5. CREATE  `tsconfig.json` — strict + target ES2022 + module NodeNext + experimentalDecorators + emitDecoratorMetadata + paths cho 8 sub-paths
6. CREATE  `tsconfig.build.json` — extends base, `outDir: dist/types`, `declaration: true`, `emitDeclarationOnly: true`, include `src/**/*`, exclude `**/*.spec.ts`/`**/*.int-spec.ts`/`test/**`
7. CREATE  `tsup.config.ts` — 8 entries (root, /orm, /context, /tenancy, /audit, /permission, /cache, /http, /jwt), dual `format: ['esm', 'cjs']`, `outDir: dist`, `clean: true`, `sourcemap: true`, `splitting: false`
8. CREATE  `jest.config.ts` — preset `ts-jest/presets/default-esm`, `testRegex: '.*\\.(spec|int-spec|e2e-spec)\\.ts$'`, coverage threshold `branches: 90, lines: 90, functions: 90, statements: 90`, `setupFilesAfterEach: ['<rootDir>/test/setup.ts']`
9. CREATE  `test/setup.ts` — global `import 'reflect-metadata'`, jest timeout config
10. CREATE  `.eslintrc.cjs` — extends `plugin:@typescript-eslint/recommended` + import-order + no-prototype-mutation + no `@shared/*` import rule (custom)
11. CREATE  `.prettierrc` — print-width 140, single quotes, trailing comma all, semi true (match be-masterdata)
12. CREATE  `.changeset/config.json` — Changesets config: `access: "public"`, `baseBranch: "main"`, changelog format keep-a-changelog
13. CREATE  `.changeset/README.md` — boilerplate explaining how to add changesets
14. CREATE  `.github/workflows/ci.yml` — trigger push & PR, matrix `[18.18, 20.x]`, steps: checkout → setup-node → npm ci → npm run lint → npm run test (coverage) → npm run build → upload coverage to Codecov (optional)
15. CREATE  `.github/workflows/release.yml` — trigger tag `v*`, steps: checkout → setup-node → npm ci → npm run build → npm publish (uses `NPM_TOKEN` secret), then create GitHub Release notes from Changesets
16. CREATE  `CHANGELOG.md` — empty placeholder with `## [Unreleased]` header
17. CREATE  `.nvmrc` — `18.18.0` (pin baseline)

**Phase 0 verification**: `npm install` succeeds, `npm run lint` passes on empty src, `npm run build` produces empty dist (or skipped — no entries yet), `npm pack --dry-run` shows expected file list.

---

### Phase 1 — Types + Utils *(no NestJS deps, pure TS, foundational)*

Sub-phase 1A: shared types (no test needed — type-only)

18. CREATE  `src/orm/types/filter.types.ts` — `SdFilterOperator` union, `SdFilter<T>`, `SdFilterAndOr<T>`, `SdOrderDirection`, `SdOrder<T>`
19. CREATE  `src/orm/types/paging.types.ts` — `SdPagingReq<T>`, `SdPagingRes<T>`
20. CREATE  `src/orm/types/repository-args.types.ts` — `BaseRepositoryArgs<T>` (relations, withDeleted, andWheres)
21. CREATE  `src/orm/types/dto.types.ts` — `Dto` marker interface (`{ id: string; deletable?: boolean; restorable?: boolean }`)
22. CREATE  `src/orm/types/api-response.types.ts` — `ApiResponse<T>` envelope (`{ data, error }`) + helpers `ApiResponse.ok(data)`, `ApiResponse.noContent()`, `ApiResponse.error(vi, en)`
23. CREATE  `src/orm/types/index.ts` — barrel

Sub-phase 1B: utils with TDD

24. CREATE  `src/utils/uuid.spec.ts` — tests cho `isUuid(v)`: v1-v5 valid → true, empty/null/random string → false, non-string types → false
25. CREATE  `src/utils/uuid.ts` — `export function isUuid(v: unknown): v is string` using regex check
26. CREATE  `src/utils/array.spec.ts` — tests cho `unique<T>(arr)` (preserve order), `distinct<T>(arr)` alias
27. CREATE  `src/utils/array.ts` — `unique` + `distinct` no prototype mutation
28. CREATE  `src/utils/object.spec.ts` — tests cho `propertyOf<T>(key)` (returns key as string, type-safe)
29. CREATE  `src/utils/object.ts` — `propertyOf<T>(key: keyof T): string`
30. CREATE  `src/utils/string.spec.ts` — tests cho `toKebabCase`, `toSnakeCase`, `toCamelCase`
31. CREATE  `src/utils/string.ts` — string case helpers
32. CREATE  `src/utils/index.ts` — barrel

**Phase 1 verification**: `npm run test src/utils src/orm/types` passes, no NestJS imports in any util/type file (grep `from '@nestjs'` returns nothing in these dirs).

---

### Phase 2 — `/context` *(ContextService + Middleware + ALS)*

Sub-phase 2A: types + token (no test)

33. CREATE  `src/context/context.types.ts` — `RequestContext` interface: `userId?, username?, fullName?, tenantCode?, departmentCode?, project?, lang?, token?, internalSecret?, user?, isSystemAdmin?, isTenantAdmin?, permissions?: string[], request?: IncomingMessage, response?: ServerResponse, custom?: Record<string, unknown>`; `HeadersConfig` interface (map header name → context key); `DEFAULT_HEADERS_CONFIG` constant matching be-masterdata
34. CREATE  `src/context/tokens.ts` — `CONTEXT_HEADERS_CONFIG = Symbol('CONTEXT_HEADERS_CONFIG')`

Sub-phase 2B: ContextService + Middleware with TDD

35. CREATE  `test/integration/context/context.int-spec.ts` — failing tests: middleware sets ALS store; `ContextService.get('userId')` returns header value; context preserved across `Promise.all`, nested `await`, `setImmediate`, `setTimeout`; missing header → `undefined`; override `HeadersConfig` qua DI changes key mapping
36. CREATE  `src/context/context.service.ts` — `@Injectable()` (DEFAULT scope), `private als = new AsyncLocalStorage<RequestContext>()`, `run(store, fn)`, `get<K>(key)`, accessor getters (`userId`, `tenantCode`, `lang`, etc — đọc từ `als.getStore()`)
37. CREATE  `src/context/context.middleware.ts` — `@Injectable() implements NestMiddleware`, `use(req, res, next)`: build store từ `req.headers` qua `HeadersConfig`, `contextService.run(store, next)`
38. CREATE  `src/context/context.module.ts` — `@Module()`, `forRoot(config?: { headers?: Partial<HeadersConfig> })`: provides `CONTEXT_HEADERS_CONFIG` (merge default + override), `ContextService`, `ContextMiddleware`; exports same
39. CREATE  `src/context/index.ts` — barrel

**Phase 2 verification**: `npm run test src/context test/integration/context` green. `grep -r "cls-hooked" src` returns nothing. `grep -r "@shared" src/context` returns nothing.

---

### Phase 3 — `/orm` core *(BaseEntity + mixins + decorators)*

Sub-phase 3A: BaseEntity + mixins with TDD

40. CREATE  `test/integration/orm/base-entity.int-spec.ts` — failing tests: `BaseEntity` chỉ có `id`, generates UUID v4 khi save; `WithTimestamps(BaseEntity)` thêm `createdAt`/`updatedAt`/`deletedAt`; `WithAudit(BaseEntity)` thêm 4 cột audit user (`createdBy`, `modifiedBy`, `creator`, `modifier`); mixin chain (`WithAudit(WithTimestamps(BaseEntity))`) không duplicate columns; metadata `Reflect.getMetadata` resolves correctly cho mixin chain
41. CREATE  `src/orm/base-entity.ts` — `export abstract class BaseEntity extends TypeOrmBaseEntity { @PrimaryColumn({ type: 'uuid' }) @Generated('uuid') id: string }`
42. CREATE  `src/orm/mixins/with-timestamps.ts` — `export function WithTimestamps<TBase extends Constructor>(Base: TBase)` returning subclass với `@CreateDateColumn createdAt`, `@UpdateDateColumn updatedAt`, `@DeleteDateColumn deletedAt`
43. CREATE  `src/orm/mixins/with-audit.ts` — `export function WithAudit<TBase extends Constructor>(Base: TBase)`: trước hết apply `WithTimestamps`, sau đó thêm `createdBy: string`, `modifiedBy: string`, `creator: UserSnapshot` (jsonb), `modifier: UserSnapshot` (jsonb); mark metadata `sdcore:audit:enabled = true` lên class
44. CREATE  `src/orm/mixins/index.ts` — barrel

Sub-phase 3B: Decorators with TDD

45. CREATE  `src/orm/decorators/__tests__/tenant-scoped.spec.ts` — failing: `@TenantScoped()` sets metadata `sdcore:tenant:scoped` lên property; `getScopedColumns(entity)` returns names; entity không có decorator → trả `[]`
46. CREATE  `src/orm/decorators/tenant-scoped.decorator.ts` — `export function TenantScoped(): PropertyDecorator` using `Reflect.defineMetadata('sdcore:tenant:scoped', true, target, propertyKey)` + helper `getScopedColumns(ctor)`
47. CREATE  `src/orm/decorators/__tests__/searchable-fields.spec.ts` — failing: `@SearchableFields({ exact, contain, activeColumn })` set metadata `sdcore:searchable`; `getSearchableConfig(ctor)` returns config; missing decorator → `undefined`
48. CREATE  `src/orm/decorators/searchable-fields.decorator.ts` — `@SearchableFields({ exact?: string[], contain?: string[], activeColumn?: string })` ClassDecorator + helper `getSearchableConfig`
49. CREATE  `src/orm/decorators/__tests__/schema.spec.ts` — failing: `@Schema()`, `@SchemaProp()` set metadata keys `sdcore:schema` + `sdcore:schema:prop`; helper `getSchemaProps(ctor)` aggregates
50. CREATE  `src/orm/decorators/schema.decorator.ts` — port từ `core-be/decorators/schema.decorator.ts` + helper, drop `@shared/*` deps
51. CREATE  `src/orm/decorators/index.ts` — barrel

**Phase 3 verification**: `npm run test src/orm/decorators src/orm/mixins test/integration/orm/base-entity` green. Pg-mem fixture test confirms TypeORM picks up columns from mixin chain.

---

### Phase 4 — `/orm` `BaseRepository` *(largest phase, split into 4A–4F)*

#### Sub-phase 4A — Filter sanitize + prepare *(pure logic, easy to TDD)*

52. CREATE  `src/orm/utils/filter-query-builder.spec.ts` — failing tests: `prepareFilter` strip empty/null/undefined filters; recursive AND/OR cleanup; `IN`/`NOT_IN` reject empty arrays; `BETWEEN` reject missing from/to; preserve `from=0`/`to=0` (truthy bug avoidance from core-be); `NULL`/`NOT_NULL` accept no-data
53. CREATE  `src/orm/utils/filter-query-builder.ts` — internal helpers `prepareFilter`, `prepareSorts`; export from utils internal
54. CREATE  `src/orm/utils/index.ts` — barrel (internal only, not in exports field)

#### Sub-phase 4B — Column/sort resolve + QB build *(SQL injection guard logic)*

55. EDIT    `src/orm/utils/filter-query-builder.spec.ts` — add tests: `resolveColumnName` reject regex-fail (returns BadRequest); JSON path `attributes.color` → `"attributes" ->> 'color'`; nested JSON `attributes.screen.size` → `"attributes" -> 'screen' ->> 'size'`; relation path `creator.fullName` → `"creator"."fullName"`; sort column resolve relation `family.members.name` → join alias `family_members.name`; missing relation/column throws BadRequest
56. EDIT    `src/orm/utils/filter-query-builder.ts` — add `resolveColumnName(field, alias, metadata)`, `resolveSortColumn(field, alias, metadata)`, `applyFilterToQuery(qb, filter, idx, alias)` (all operators)

#### Sub-phase 4C — BaseRepository read methods *(paging, all, search, detail)*

57. CREATE  `test/integration/orm/base-repository.paging.int-spec.ts` — failing tests via pg-mem: `paging({pageNumber:0, pageSize:10})` returns first page; `pageSize` clamp max 1000; `pageNumber` min 0; sorting ASC `NULLS FIRST`, DESC `NULLS LAST`; multi-sort priority; soft-deleted excluded by default; `withDeleted: true` includes
58. CREATE  `test/integration/orm/base-repository.filters.int-spec.ts` — failing tests: every operator (EQUAL/NOT_EQUAL/LT/LE/GT/GE/CONTAIN/NOT_CONTAIN/START_WITH/END_WITH/NOT_START_WITH/NOT_END_WIDTH/BETWEEN/IN/NOT_IN/NULL/NOT_NULL) returns expected rows; AND/OR recursive; JSON path filter on jsonb column; relation path filter joins correctly; field name with non-alphanumeric → BadRequest
59. CREATE  `test/integration/orm/base-repository.search.int-spec.ts` — failing: `search(uuid)` returns single by id, bypass tenancy + filters; `search(text)` no `@SearchableFields` → empty array; with `@SearchableFields({exact:['code'], contain:['name'], activeColumn:'isActive'})` → exact match on code OR contain on name AND active=true; `containFields` LIKE uses `LOWER(UNACCENT(...))`
60. CREATE  `src/orm/base-repository.ts` (PART 1: read methods) — `BaseRepository<T>` class skeleton, constructor `(target, datasource, options?)`, getters `queryRunner`/`repository`/`target`/`getRepository(qr?)`; methods `paging`, `pagingDeleted`, `all`, `search`, `detail`; private `#createBaseQueryBuilder`, `#preparePagingReq`; uses helpers from 4A+4B; **NO tenancy/audit hooks yet** (placeholder `#addonFilter = (f) => f`)

#### Sub-phase 4D — BaseRepository CUD *(create, update, delete, softDelete, restore, import)*

61. CREATE  `test/integration/orm/base-repository.cud.int-spec.ts` — failing tests: `create` saves entity + returns; `update(entity)` saves changes + returns; `delete(id)` hard removes; `delete(['id1','id2'])` bulk; `softDelete(id)` sets deletedAt + paging excludes; `restore(id)` clears deletedAt; `import([entities])` chunked 1000, returning `*`; **no audit hooks called** (placeholder for now)
62. EDIT    `src/orm/base-repository.ts` (PART 2: CUD) — add methods: `create`, `update`, `delete`, `softDelete`, `restore`, `import`; helper `#logHistory` STUB (no-op — defer ActionHistory per spec); audit hook placeholder (call `IAuditStrategy.onCreate(entity, ctx)` if strategy injected — but injection from /audit happens phase 7)

#### Sub-phase 4E — BaseRepository UUID validation

63. EDIT    `test/integration/orm/base-repository.cud.int-spec.ts` — add tests: `detail(invalidUuid)` throws BadRequest; valid uuid → returns entity
64. EDIT    `src/orm/base-repository.ts` (PART 3: validation) — `detail` validates uuid via `isUuid` from utils throws `BadRequest` cho invalid input. **`checkUsedIds` KHÔNG được port** vì column `usedIds` đã drop khỏi `BaseEntity` per spec — consumer nào cần feature này tự thêm column + method ở subclass.

#### Sub-phase 4F — `IBaseRepository` interface export + index

65. CREATE  `src/orm/base-repository.interface.ts` — interface `IBaseRepository<T>` extracted from class shape (for DI / mocking)
66. CREATE  `src/orm/index.ts` — barrel exports: `BaseEntity`, `WithTimestamps`, `WithAudit`, decorators, `BaseRepository`, `IBaseRepository`, types, helpers (`isUuid` re-export for ergonomic import path)

**Phase 4 verification**: all `test/integration/orm/*` green với pg-mem; `npm run lint src/orm` zero errors; subscribe to `git diff` showing no `@shared/*` import in any `src/orm/**` file.

---

### Phase 5 — `/orm` `BaseService` + `BaseController`

67. CREATE  `src/orm/base-service.spec.ts` — failing tests: `paging` proxies to repository + maps DTO; `delete` filters dtos by `deletable: true`; `softDelete` filters by `deletable`; `restore` filters by `restorable`; abstract `mapDTO` required
68. CREATE  `src/orm/base-service.ts` — `BaseService<T, Dto>`, abstract `mapDTO`, methods: `paging`, `pagingDeleted`, `all`, `search`, `detail`, `create`, `import`, `update`, `delete`, `softDelete`, `restore`, `schema()` helper (reads Schema decorator metadata)
69. CREATE  `src/orm/base-controller.spec.ts` — failing tests via supertest + nest test module: REST endpoints wired (`POST /search`, `POST /paging`, `POST /paging/deleted`, `GET /all`, `GET /:id`, `DELETE /:id`, `DELETE /:id/soft`, `PUT /:id/restore`); response wrapped in `ApiResponse`
70. CREATE  `src/orm/base-controller.ts` — `BaseController<T, Dto>` with REST decorators
71. EDIT    `src/orm/index.ts` — re-export `BaseService`, `BaseController`

**Phase 5 verification**: `npm run test src/orm` all green.

---

### Phase 6 — `/tenancy`

72. CREATE  `src/tenancy/strategy.interface.ts` — `ITenancyStrategy` interface (`getCurrentScope(ctx)`, `shouldBypass(ctx)`)
73. CREATE  `src/tenancy/tokens.ts` — `TENANCY_STRATEGY = Symbol('TENANCY_STRATEGY')`
74. CREATE  `src/tenancy/default-tenancy.strategy.ts` — no-op `DefaultTenancyStrategy` (`getCurrentScope: () => ({})`, `shouldBypass: () => true`) — means "tenancy disabled when default"
75. CREATE  `test/integration/tenancy/tenancy.int-spec.ts` — failing tests: 2 entities (1 `@TenantScoped` cols, 1 không) — strategy returns scope → entity với `@TenantScoped` bị inject filter EQUAL ở paging/all/detail/search; entity không có decorator không bị scoped; `shouldBypass=true` skips inject AND skip auto-fill on create; consumer KHÔNG register strategy → BaseRepository hành xử như tenancy disabled (zero magic, no metadata lookup)
76. CREATE  `src/tenancy/tenancy.helpers.ts` — `getScopedColumns(entityClass): string[]`, `buildScopeFilters(scope, scopedCols): SdFilter[]`, `applyScopeToEntity(entity, scope, scopedCols): void` — pure functions
77. CREATE  `src/tenancy/tenancy.module.ts` — `@Module()`, `forRoot({ strategy?: Provider }): DynamicModule` providing `TENANCY_STRATEGY` (default = `DefaultTenancyStrategy`), exports same
78. CREATE  `src/tenancy/index.ts` — barrel exports; re-export `@TenantScoped` từ `/orm/decorators` for ergonomic import
79. EDIT    `src/orm/base-repository.ts` — integrate tenancy: constructor accepts optional `@Inject(TENANCY_STRATEGY) strategy?`; method `#addonFilter` reads `getScopedColumns(target)` + calls `strategy.getCurrentScope() / shouldBypass()`; `create`/`import` auto-fill scoped columns; **strategy không inject → branch skip entirely (zero overhead)**
80. EDIT    `test/integration/orm/base-repository.filters.int-spec.ts` — add tenancy integration tests (cross-phase: ensures Phase 4 + 6 wired correctly)
81. EDIT    `test/integration/orm/base-repository.cud.int-spec.ts` — add tenancy auto-fill tests on create/import

**Phase 6 verification**: `npm run test test/integration/tenancy test/integration/orm` all green; "no strategy registered" path passes coverage threshold.

---

### Phase 7 — `/audit`

82. CREATE  `src/audit/types.ts` — `UserSnapshot` interface (`{ id: string; username: string; fullName: string }`, extensible via generic)
83. CREATE  `src/audit/strategy.interface.ts` — `IAuditStrategy` (`onCreate(entity, ctx)`, `onUpdate(entity, ctx)`, `onSoftDelete(entity, ctx)`)
84. CREATE  `src/audit/tokens.ts` — `AUDIT_STRATEGY = Symbol('AUDIT_STRATEGY')`
85. CREATE  `src/audit/default-audit.strategy.ts` — `DefaultAuditStrategy` (`@Injectable()`, inject `ContextService`): `onCreate` sets `createdBy`, `creator`, `modifiedBy`, `modifier` if `ctx.userId`; `onUpdate` sets only `modifiedBy`, `modifier`; `onSoftDelete` no-op (timestamp tự sinh)
86. CREATE  `test/integration/audit/audit.int-spec.ts` — failing tests: `AuditSubscriber` fires `onCreate` ở `beforeInsert` chỉ cho entity với metadata `sdcore:audit:enabled` (set bởi WithAudit mixin); `WithTimestamps`-only entity → subscriber không gọi strategy; `onUpdate` fires `beforeUpdate`; `onSoftDelete` fires `beforeSoftRemove`; `ctx.userId` undefined → strategy skips (không throw)
87. CREATE  `src/audit/audit.subscriber.ts` — `@Injectable() implements EntitySubscriberInterface`, methods `beforeInsert/Update/SoftRemove`, check `Reflect.getMetadata('sdcore:audit:enabled', entity.constructor)`, call strategy nếu enabled
88. CREATE  `src/audit/audit.module.ts` — `forRoot({ strategy?: Provider }): DynamicModule`, provides `AUDIT_STRATEGY` (default `DefaultAuditStrategy`), provides `AuditSubscriber`, register subscriber với DataSource onModuleInit
89. CREATE  `src/audit/index.ts` — barrel
90. EDIT    `src/orm/base-repository.ts` — integrate audit hook trong `create` + `import`: gọi `strategy?.onCreate(entity, ctx)` cho mỗi entity (subscriber không trigger với bulk insert raw); guard: chỉ gọi nếu entity có metadata `sdcore:audit:enabled`
91. EDIT    `test/integration/orm/base-repository.cud.int-spec.ts` — add tests: `create` calls `IAuditStrategy.onCreate`; `import` calls onCreate per entity in chunk (verify via spy); `WithTimestamps`-only entity → no audit strategy call

**Phase 7 verification**: `npm run test test/integration/audit test/integration/orm` green.

---

### Phase 8 — `/permission`

92. CREATE  `src/permission/strategy.interface.ts` — `IPermissionStrategy` (`load(ctx): Promise<string[]>`, optional `check(codes, required): boolean`)
93. CREATE  `src/permission/tokens.ts` — `PERMISSION_STRATEGY = Symbol('PERMISSION_STRATEGY')`, `PERMISSION_METADATA_KEY = 'sdcore:permission:any'`
94. CREATE  `src/permission/default-permission.strategy.ts` — `DefaultPermissionStrategy`: `load: async () => []` (deny-all default), `check: (codes, req) => codes.includes(req)`
95. CREATE  `src/permission/decorators/__tests__/has-permission.spec.ts` — failing: `@HasPermission('product:create')` sets metadata `[ 'product:create' ]`; `@HasAnyPermission(a, b, c)` sets `[a, b, c]`; reflector resolves on method and class
96. CREATE  `src/permission/decorators/has-permission.decorator.ts` — `HasPermission(code)` via `SetMetadata(PERMISSION_METADATA_KEY, [code])`
97. CREATE  `src/permission/decorators/has-any-permission.decorator.ts` — `HasAnyPermission(...codes)` via `SetMetadata(PERMISSION_METADATA_KEY, codes)`
98. CREATE  `src/permission/decorators/index.ts` — barrel
99. CREATE  `test/integration/permission/auth-guard.int-spec.ts` — failing: `AuthGuard` extends `PassportAuthGuard('jwt')`; sau auth thành công gọi `IPermissionStrategy.load(ctx)` 1 lần, cache vào `req.permissions`; endpoint không có metadata → pass; với `@HasPermission` + codes match → pass; mismatch → 403 với `{ vi, en }`; consumer override `check` function (ví dụ wildcard) → respected
100. CREATE  `src/permission/auth.guard.ts` — `@Injectable() extends PassportAuthGuard('jwt')`, override `canActivate`: super.canActivate → load permissions → check via strategy
101. CREATE  `src/permission/permission.module.ts` — `forRoot({ strategy?: Provider }): DynamicModule`, provides `PERMISSION_STRATEGY` + `AuthGuard`
102. CREATE  `src/permission/index.ts` — barrel

**Phase 8 verification**: `npm run test test/integration/permission src/permission` green.

---

### Phase 9 — `/jwt`

103. CREATE  `src/jwt/types.ts` — `JwtConfig` interface (`secret`, `expiresIn?`, `issuer?`, `audience?`, `cookieName?` optional)
104. CREATE  `src/jwt/jwt.strategy.spec.ts` — failing: extract token from `Authorization: Bearer X`; cookie fallback if config; payload returned to passport
105. CREATE  `src/jwt/jwt.strategy.ts` — `@Injectable() extends PassportStrategy(Strategy, 'jwt')` from `passport-jwt`
106. CREATE  `src/jwt/jwt.module.ts` — `forRoot(config: JwtConfig): DynamicModule`, registers passport strategy + provides config
107. CREATE  `src/jwt/index.ts` — barrel

**Phase 9 verification**: `npm run test src/jwt` green.

---

### Phase 10 — `/cache`

108. CREATE  `src/cache/types.ts` — `CacheConfig` (`backend: 'memory' | 'redis'`, `ttl?`, `redis?: { host, port, password? }`)
109. CREATE  `src/cache/cache.service.spec.ts` — failing: `get/set/del/clear`; TTL expiry (fake timers); LRU eviction at limit; Redis backend mocked
110. CREATE  `src/cache/cache.service.ts` — `@Injectable() CacheService`, in-memory LRU mặc định; pluggable backend if Redis configured
111. CREATE  `src/cache/decorators/cached.decorator.ts` — `@Cached({ ttl, keyResolver? })` MethodDecorator + helper to wrap original method
112. CREATE  `src/cache/cache.interceptor.spec.ts` — failing: cache return value; key incorporates method path + args + tenant scope (when ITenancyStrategy registered); cache hit → no method call; TTL elapsed → re-execute
113. CREATE  `src/cache/cache.interceptor.ts` — `@Injectable() CacheInterceptor implements NestInterceptor`, build cache key, return cached or run original + cache
114. CREATE  `src/cache/request-cache.middleware.ts` — per-request cache scope (port từ core-be), in-memory map per request
115. CREATE  `src/cache/cache.module.ts` — `forRoot(config?: CacheConfig): DynamicModule`
116. CREATE  `src/cache/index.ts` — barrel

**Phase 10 verification**: `npm run test src/cache` green; tenant-aware key test fires only when /tenancy is wired alongside.

---

### Phase 11 — `/http`

117. CREATE  `src/http/types.ts` — `HttpClientConfig` (`baseURL?`, `timeout?`, `retries?`, `propagateHeaders?: string[]`)
118. CREATE  `src/http/http.service.spec.ts` — failing: `get/post/put/delete/patch` returns typed `T`; outbound call auto-propagates `tenantCode`, `userId`, etc từ context; timeout/retries respected
119. CREATE  `src/http/http.service.ts` — `@Injectable() HttpService` axios-based; constructor accepts config + ContextService; interceptor adds context headers
120. CREATE  `src/http/http.module.ts` — `forRoot(config?: HttpClientConfig): DynamicModule`
121. CREATE  `src/http/index.ts` — barrel

**Phase 11 verification**: `npm run test src/http` green.

---

### Phase 12 — Root `SdCoreModule.forRoot()` wire-up

122. CREATE  `src/sd-core.module.spec.ts` — failing: `SdCoreModule.forRoot({ context: {...}, tenancy: { strategy: X }, audit: { strategy: Y }, permission: { strategy: Z }, cache: {...}, http: {...}, jwt: { secret: 's' } })` boots without error; each sub-module receives its config; default strategies registered when consumer skips
123. CREATE  `src/sd-core.module.ts` — `@Module()` + static `forRoot(config: SdCoreModuleOptions): DynamicModule` that composes ContextModule.forRoot + TenancyModule.forRoot + AuditModule.forRoot + PermissionModule.forRoot + CacheModule.forRoot + HttpClientModule.forRoot + JwtModule.forRoot
124. CREATE  `src/sd-core.types.ts` — `SdCoreModuleOptions` interface (per-sub-module config), `SdCoreSyncOptions` vs `SdCoreAsyncOptions` (forRootAsync support deferred unless trivial)
125. CREATE  `src/index.ts` — root barrel: `SdCoreModule`, `SdCoreModuleOptions`, re-export commonly used `ContextService`, key tokens

**Phase 12 verification**: `npm run test src/sd-core.module` green; `npm run build` produces all 8 sub-path bundles; `node -e "require('@sdcorejs/nestjs')"` từ link-installed test app loads without error.

---

### Phase 13 — E2E consumer app + Migration README

126. CREATE  `test/fixtures/sample-entity.ts` — `class Product extends WithAudit(BaseEntity)` + `@SearchableFields({...})` + `@TenantScoped()` on `tenantCode`, `departmentCode`
127. CREATE  `test/fixtures/sample-tenancy-strategy.ts` — implements `ITenancyStrategy` reading from ContextService
128. CREATE  `test/fixtures/sample-audit-strategy.ts` — implements `IAuditStrategy` reading from ContextService
129. CREATE  `test/fixtures/sample-permission-strategy.ts` — implements `IPermissionStrategy` returning hardcoded codes
130. CREATE  `test/fixtures/pg-mem-datasource.ts` — pg-mem DataSource factory for tests
131. CREATE  `test/fixtures/consumer-app.module.ts` — fake NestJS app importing `SdCoreModule.forRoot({...})` + sample strategies + sample entity + minimal controller
132. CREATE  `test/e2e/consumer-app.e2e-spec.ts` — supertest against booted NestJS app: `POST /products/paging` returns 200 với data; `POST /products` creates entity với audit + tenancy fields filled; `DELETE /products/:id/soft` then `POST /products/paging/deleted` returns 1
133. EDIT    `README.md` — full content: badges, installation, quick start, per-sub-path usage examples (root + 8 sub-paths), `Migration from be-masterdata/core-be` section với checklist (steps: install lib, write 3 strategies, swap `@core/*` imports → `@sdcorejs/nestjs/*`, run tests, deploy)
134. CREATE  `docs/migration-from-core-be.md` (optional supplementary doc) — chi tiết migration steps, mapping bảng (core-be path → @sdcorejs/nestjs sub-path), known gotchas (mixin metadata, ALS migration, prototype removal helpers)

**Phase 13 verification**: `npm run test:e2e` passes; README renders correctly on GitHub Markdown preview.

---

### Phase 14 — Final verification + release prep

135. RUN    `npm install` — confirm lockfile reproducible
136. RUN    `npm run lint` — zero errors
137. RUN    `npm run test` — all unit + integration green, coverage ≥90% lines/branches/functions/statements on `src/**`
138. RUN    `npm run test:e2e` — consumer-app e2e green
139. RUN    `npm run build` — produces `dist/esm/*.mjs` + `dist/cjs/*.cjs` + `dist/types/**/*.d.ts` cho cả 8 sub-paths
140. RUN    `npm pack --dry-run` — confirm `dist/`, `README.md`, `LICENSE`, `CHANGELOG.md` shipped; KHÔNG ship `src/`, `test/`, `coverage/`, `node_modules/`, `tsconfig*.json`
141. RUN    `npx changeset` — create initial changeset for `v0.1.0`
142. VERIFY  acceptance criteria checklist (manual): tick từng AC trong spec — pass / fail / N/A; produce summary report
143. VERIFY  npm scope `@sdcorejs` ownership (browse `npmjs.com/~sdcorejs` or `npm access ls-packages`) — nếu chưa có quyền, document workaround trước khi publish
144. RUN    `git commit` + `git tag v0.1.0` (manual, user decides timing) — defer actual publish until user explicitly runs `npm publish` or pushes tag to GitHub triggering release.yml

**Phase 14 verification (final gate)**: all checks green; spec AC report 100% pass; sample npm install + boot test works.

---

## Verification commands (per phase quick reference)

```bash
# Foundation
npm install
npm run lint
npm run build

# Test suite
npm run test                                 # unit + integration with coverage
npm run test:e2e                             # supertest e2e
npm run test -- src/utils                    # phase-specific
npm run test -- src/orm                      # /orm only
npm run test -- test/integration/tenancy     # tenancy integration
npm run test -- --coverage --coverageThreshold='{"global":{"branches":90,"lines":90,"functions":90,"statements":90}}'

# Package validation
npm pack --dry-run                           # see ship manifest
npm publish --dry-run --access public        # validate publish without actually publishing
npx changeset status                         # confirm changeset present

# Manual smoke (after npm link to a fresh nest app)
cd /tmp/test-consumer && npm install @sdcorejs/nestjs
node -e "require('@sdcorejs/nestjs/orm')"     # CJS load
node --input-type=module -e "import { BaseEntity } from '@sdcorejs/nestjs/orm'"  # ESM load
```

---

## Risks specific to plan execution

- **Phase 4F validation gap**: `BaseEntity` không còn cột `usedIds` (theo spec — bỏ khỏi BaseEntity); `checkUsedIds` cần guard "skip if column not present". AC liên quan ở Phase 14 cần re-check vs spec.
- **Phase 6 + 4D overlap**: `BaseRepository` tenancy integration phải làm SAU khi cả `/tenancy` interface + `/orm/base-repository` đã có skeleton. Plan giả định Phase 6 EDITs `base-repository.ts` ngay khi tenancy module sẵn sàng. Test integration cross-phase (`Phase 4 + Phase 6 test`) cần re-run sau Phase 6.
- **Phase 7 audit subscriber + bulk insert**: TypeORM subscribers KHÔNG trigger với `qb.insert().values()`. Phase 7 step 90 (EDIT base-repository.ts) bắt buộc — nếu skip thì `import()` bypass audit. Test ở step 91 verify.
- **Phase 12 forRootAsync**: nếu consumer cần inject ConfigService async, `forRootAsync` cần thêm. Plan hiện chỉ `forRoot` sync. Defer `forRootAsync` to v0.2 nếu user OK; nếu không sẽ ship Phase 12 thêm step.
- **Phase 14 npm scope**: nếu `@sdcorejs` org chưa được create / chiếm, Phase 14 step 143 phát hiện sớm. Plan B: rename `@sdcore-js` hoặc `@sdcorejs-nestjs` (non-scoped), communicate trước khi tag `v0.1.0`.

---

## Confirm

Plan này có phù hợp không?
- **"OK, generate"** / **"duyệt"** → tail-call `sdcorejs-auto-plans` snapshot vào `.sdcorejs/plans/nestjs/`, rồi invoke `nestjs-write-code` orchestrator (manual plan-walking — vì sub-skills 10/11/12 chưa ship)
- **"Đổi step <N>"** → mình sửa step đó và trình lại plan
- **"Đổi phase order"** → mình reorganize (ví dụ làm /jwt trước /permission, hoặc gom /cache+/http thành 1 phase)
- **"Quay lại spec"** → invoke `sdcorejs-review-spec` để revisit AC

> Lưu ý quy mô: ~144 numbered steps, ~14 phase. Đây là 1 lib lớn — plan dự kiến chia thành nhiều session khi vào `write-code`. Mỗi phase là 1 đơn vị work + verify hợp lý.
