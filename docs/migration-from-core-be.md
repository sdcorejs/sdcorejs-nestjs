# Migration — `be-masterdata/core-be/` → `@sdcorejs/nestjs`

Checklist for porting an existing app off `be-masterdata/base/core-be/` to the npm-published library.

## 1. Install

```bash
npm install @sdcorejs/nestjs @sdcorejs/utils
npm install --save-dev @nestjs/passport passport passport-jwt @types/passport-jwt
```

Peer-deps already in your project: `@nestjs/common ^11`, `@nestjs/core ^11`, `typeorm ^0.3.20`, `reflect-metadata ^0.2`, `rxjs ^7.8`.

Drop runtime deps no longer needed: `cls-hooked` (replaced by `AsyncLocalStorage`), local copies of `String.prototype.isUuid` / `Array.prototype.distinct` / `Object.propertyOf` shims.

## 2. Strategy implementations

The lib does not ship SD-specific tenancy/audit/permission. Implement them in your app and register via `SdCoreModule.forRoot`.

```ts
// app/strategies/tenancy.strategy.ts
@Injectable()
export class SdTenancyStrategy implements ITenancyStrategy {
  constructor(private readonly ctx: ContextService) {}
  getCurrentScope(rc: RequestContext) {
    return { tenantCode: rc.tenantCode, departmentCode: rc.departmentCode };
  }
  shouldBypass(rc: RequestContext) {
    return rc.isSystemAdmin === true;
  }
}
```

Mirror for `SdAuditStrategy` (fill `createdBy`, `creator`, `modifiedBy`, `modifier` from your `UserDTO`) and `SdPermissionStrategy` (load codes from your `PagePermissionService`).

## 3. Bootstrap

```ts
// app.module.ts
@Module({
  imports: [
    SdCoreModule.forRoot({
      context: {
        headers: { /* override default header names if needed */ },
      },
      tenancy:    { strategy: SdTenancyStrategy },
      audit:      { strategy: SdAuditStrategy },
      permission: { strategy: SdPermissionStrategy },
      cache:      { ttl: 60 },
      http:       { baseURL: process.env.UPSTREAM_API },
      jwt:        { secret: process.env.JWT_SECRET! },
    }),
    // your domain modules...
  ],
})
export class AppModule {}
```

## 4. Import path swap

| Old (`core-be/`) | New |
|---|---|
| `@core/base` (BaseEntity, BaseRepository, BaseService, BaseController) | `@sdcorejs/nestjs/orm` |
| `@core/decorators` (HasPermission, Schema, SchemaProp) | `@sdcorejs/nestjs/orm` + `@sdcorejs/nestjs/permission` |
| `@core/guards` (AuthGuard) | `@sdcorejs/nestjs/permission` |
| `@core/modules/api/context` (SdContext) | `@sdcorejs/nestjs/context` (now `ContextService`, injectable) |
| `@core/modules/cache` | `@sdcorejs/nestjs/cache` |
| `@core/modules/http` | `@sdcorejs/nestjs/http` |
| `@core/modules/jwt` | `@sdcorejs/nestjs/jwt` |
| `@shared/core` (SdFilter, SdPagingReq, SdOrder, etc.) | `@sdcorejs/utils/models` (Filter, PagingReq, Order — `Sd*` aliases also re-exported from `@sdcorejs/nestjs/orm` for soft migration) |
| `String.isUuid(v)` | `import { ValidationUtilities } from '@sdcorejs/utils/fns'` → `ValidationUtilities.isUuid(v)` |
| `[].distinct()` | `ArrayUtilities.distinct(arr)` |
| `Object.propertyOf<T>(key)` | `import { propertyOf } from '@sdcorejs/nestjs/orm'` |

## 5. Entity changes

```diff
- export class Product extends BaseEntity {
+ export class Product extends WithAudit(BaseEntity) {
    @Column() @TenantScoped() tenantCode: string;
    @Column() @TenantScoped() departmentCode: string;
+   // No need to redeclare createdAt/createdBy/creator/modifier — WithAudit adds them.
  }
```

If the entity used `usedIds` / `formGeneric` / `formGenericData`, those are no longer in `BaseEntity` — declare them on the subclass yourself if you still need them.

## 6. Operator rename

`NOT_END_WIDTH` (typo in `core-be`) → `NOT_END_WITH` in `@sdcorejs/utils`. Find/replace across call sites:

```bash
grep -rE "NOT_END_WIDTH" src/ | wc -l   # before
sed -i 's/NOT_END_WIDTH/NOT_END_WITH/g' src/**/*.ts
```

## 7. Known gotchas

- **Mixin metadata**: TypeORM picks up columns from `WithAudit(BaseEntity)` because the mixin class still has decorators. If you see "Entity X is missing column Y" after migration, verify the mixin chain order matches the example: `WithAudit(BaseEntity)`, NOT `WithAudit(WithTimestamps(BaseEntity))` (which double-adds timestamps).
- **`AsyncLocalStorage` vs `cls-hooked`**: ALS preserves context across `await` chains automatically. Manual `session.run(...)` is now `contextService.run(store, fn)`. The cls-hooked `getNamespace` pattern is gone — use `ContextService` accessors.
- **ActionHistory**: not yet abstracted. If you used `BaseRepository.options.logHistory = true`, that flag is parsed but no-op in `v0.1`. Wire your own subscriber or wait for `v0.2`.
- **FileStorage**: not in `v0.1`. Continue using the local `core-be/modules/file-storage` until the lib version ships.

## 8. Verification

```bash
npm run build       # type-check + compile
npm run test        # unit + integration
npm run test:e2e    # supertest against a real Nest app
```

If `BaseRepository` operations succeed in tests with `tenancy.strategy` registered and audit fields populate on create, the swap is complete.
