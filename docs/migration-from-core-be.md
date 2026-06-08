# Migration — `be-masterdata/core-be/` → `@sdcorejs/nestjs`

Checklist for porting an existing app off `be-masterdata/base/core-be/` to the npm-published library.

## 1. Install

```bash
npm install @sdcorejs/nestjs @sdcorejs/utils
npm install --save-dev @nestjs/passport passport passport-jwt @types/passport-jwt
npm install zod@^4   # validation uses Zod v4 (NOT v3)
```

Peer-deps already in your project: `@nestjs/common ^11`, `@nestjs/core ^11`, `typeorm ^0.3.20`, `reflect-metadata ^0.2`, `rxjs ^7.8`.

Drop runtime deps no longer needed: `cls-hooked` (replaced by `AsyncLocalStorage`), local copies of `String.prototype.isUuid` / `Array.prototype.distinct` / `Object.propertyOf` shims.

## 2. Strategy implementations

The lib does not ship SD-specific tenancy/audit/permission. Implement them in your app and register via `SdCoreModule.forRoot`.

> The library's `RequestContext` only has framework-generic keys (`userId`, `tenant`, `lang`, `token`, `user`, `permissions`, `custom`). Domain values like `departmentCode` / `isSystemAdmin` live in `ctx.custom` or via declaration merging — see [§7](#7-domain-fields--consumer). Read them from `custom` (or your merged fields), NOT from non-existent top-level keys.

```ts
// app/strategies/tenancy.strategy.ts
@Injectable()
export class SdTenancyStrategy implements ITenancyStrategy {
  getCurrentScope(rc: RequestContext): Record<string, unknown> {
    return {
      tenantCode: rc.tenant,                            // scalar  → EQUAL filter
      departmentCode: rc.custom?.['departmentCodes'],   // array   → IN filter (multi-department)
    };
  }
  shouldBypass(rc: RequestContext): boolean {
    return rc.custom?.['isSystemAdmin'] === true || rc.custom?.['isInternalCall'] === true;
  }
}
```

> **Array scope = `IN`.** Returning an array for a scoped column (e.g. a user spanning several departments) now emits an `IN (...)` filter instead of `EQUAL`. Empty arrays / `null` / `undefined` are skipped. This applies to list reads AND `detail(id)`.

Mirror for `SdAuditStrategy` (fill `createdBy`, `creator`, `modifiedBy`, `modifier` from your `UserDTO`) and `SdPermissionStrategy`:

```ts
@Injectable()
export class SdPermissionStrategy implements IPermissionStrategy {
  constructor(private readonly pages: PagePermissionService) {}
  async load(rc: RequestContext): Promise<string[]> {
    return this.pages.codesForUser(rc.userId);
  }
  // Optional: override default Array.includes for wildcard/hierarchy support.
  check(codes: string[], required: string): boolean {
    return codes.some((c) => c === required || (c.endsWith(':*') && required.startsWith(c.slice(0, -1))));
  }
}
```

`AuthGuard` mirrors the authenticated `user` and the resolved `permissions` into `ContextService` after auth — so `contextService.hasPermission(code)` works in any downstream service without re-loading. In `core-be` this was a manual `SdContext.set`; it is now automatic.

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
      jwt:        { jwks: { allowedIssuers: [process.env.KEYCLOAK_ISSUER!] } },
      providers: [
        { provide: INTERNAL_SECRET_PROVIDER,  useClass: SdInternalSecretProvider },
        { provide: INTERNAL_CONTEXT_ENRICHER, useClass: SdInternalEnricher },
      ],
    }),
    // your domain modules...
  ],
})
export class AppModule {}
```

### 3a. Keycloak JWT

`core-be` verified Keycloak tokens with a bespoke guard. The lib wires `KeycloakJwtStrategy` automatically when `jwt.jwks` is set — signing keys are fetched per-token from each issuer's JWKS endpoint (multi-realm, no shared secret). Requires `jwks-rsa` + `jsonwebtoken`.

Subclass to turn the verified token into your user object:

```ts
@Injectable()
export class AppJwtStrategy extends KeycloakJwtStrategy {
  constructor(@Inject(JWT_CONFIG) cfg: JwtConfig, private readonly users: UserService) {
    super(cfg);
  }
  async validate(payload: JwtPayload) {
    const user = await this.users.byKeycloakId(payload.sub);
    if (!user) throw new UnauthorizedException();
    return user; // becomes req.user → mirrored into ContextService.user by AuthGuard
  }
}
```

Register it (constructor deps need their module imported):

```ts
JwtModule.forRoot(
  { jwks: { allowedIssuers: [process.env.KEYCLOAK_ISSUER!] } },
  { strategy: AppJwtStrategy, imports: [UserModule] },
)
```

Symmetric secret instead of JWKS: pass `jwt: { secret: process.env.JWT_SECRET! }` (omit `jwks`) → the symmetric `JwtStrategy` is wired.

### 3b. Internal service-to-service calls

`core-be` used an ad-hoc internal-secret check. The lib's `InternalGuard` reads `X-Internal-Secret`, compares constant-time, and exposes two DI hooks:

```ts
@Injectable()
export class SdInternalSecretProvider implements IInternalSecretProvider {
  getKey(): string { return process.env.INTERNAL_SECRET!; }
  // Optional zero-downtime rotation — accept old + new during the transition window:
  getKeys(): string[] {
    return [process.env.INTERNAL_SECRET!, process.env.INTERNAL_SECRET_NEXT!].filter(Boolean);
  }
}

// Optional — runs ONLY after the secret check passes, so trusting inbound headers is safe:
@Injectable()
export class SdInternalEnricher implements IInternalContextEnricher {
  constructor(private readonly ctx: ContextService) {}
  enrich(req: IncomingMessage): void {
    const h = req.headers;
    this.ctx.set('tenant', h['x-tenant'] as string);
    this.ctx.set('userId', h['x-user-id'] as string);
    this.ctx.set('custom', { isInternalCall: true, caller: h['x-caller'] });
  }
}
```

Apply with `@UseGuards(InternalGuard)`. The enricher's `custom.isInternalCall` is what `SdTenancyStrategy.shouldBypass()` reads to skip tenant filtering on internal traffic.

## 4. Import path swap

| Old (`core-be/`) | New |
|---|---|
| `@core/base` (BaseEntity, BaseRepository, BaseService, BaseController) | `@sdcorejs/nestjs/orm` |
| `@core/decorators` (HasPermission, Schema, SchemaProp) | `@sdcorejs/nestjs/orm` + `@sdcorejs/nestjs/permission` |
| `@core/guards` (AuthGuard, InternalGuard) | `@sdcorejs/nestjs/permission` |
| `@core/modules/api/context` (SdContext) | `@sdcorejs/nestjs/context` (now `ContextService`, injectable) |
| `@core/modules/cache` | `@sdcorejs/nestjs/cache` |
| `@core/modules/http` | `@sdcorejs/nestjs/http` |
| `@core/modules/jwt` | `@sdcorejs/nestjs/jwt` |
| `@shared/core` (SdFilter, SdPagingReq, SdOrder, etc.) | `@sdcorejs/utils/models` (Filter, PagingReq, Order). The `Sd*` aliases were removed in 1.0.0 — use the canonical names. |
| `String.isUuid(v)` | `import { ValidationUtilities } from '@sdcorejs/utils/fns'` → `ValidationUtilities.isUuid(v)` |
| `[].distinct()` | `ArrayUtilities.distinct(arr)` |
| `Object.propertyOf<T>(key)` | type-only — use `NestedKeyOf<T>` from `@sdcorejs/utils/models` (`Filter.field` / `Order.field` already typed with it) |

## 5. Entity changes

```diff
- export class Product extends BaseEntity {
+ export class Product extends WithAudit(BaseEntity) {
    @Column() @Scoped() tenantCode: string;
    @Column() @Scoped() departmentCode: string;
+   // No need to redeclare createdAt/createdBy/creator/modifier — WithAudit adds them.
  }
```

If the entity used `usedIds` / `formGeneric` / `formGenericData`, those are no longer in `BaseEntity` — declare them on the subclass yourself if you still need them.

## 5a. Validation → Zod v4

The lib's validation is Zod **v4** (`zod@^4`). If `core-be` used class-validator or Zod v3, swap to Zod schemas + `ZodValidationGuard`. v4 differs from v3 (issue shape, `z.email()`/`z.uuid()` top-level) — pin `zod@^4`.

```ts
const CreateProduct = z.object({ name: z.string().min(3, 'core.product.name.min') });

@UseGuards(AuthGuard, ZodValidationGuard(CreateProduct))           // single source
@UseGuards(AuthGuard, ZodValidationGuard({ body: CreateProduct, query: zPaging })) // multi-source
```

Query params are strings → use presets (`zPaging`, `zUuid`, `zBool`) or `z.coerce.*`. Each validation issue now carries `params` (e.g. `{ minimum: 3 }`) for i18n interpolation.

## 5b. i18n end-to-end

`core-be` translated errors in a hand-rolled filter. The lib ships the full chain — enable with the `i18n` key:

```ts
SdCoreModule.forRoot({
  i18n: {
    fallbackLanguage: 'vi',
    catalogs: { vi: { 'app.x': 'Thông điệp {var}' } }, // merged over built-in core.* en/vi
  },
});
```

This wires `SdI18nExceptionFilter` (catches `apiError` HttpExceptions, localizes `message` from `ctx.lang`, keeps `code`), `SimpleI18nResolver` (catalog + `{var}` interpolation), and `DefaultLanguageResolver` (Accept-Language parser). The lib's own `core.*` codes have built-in en/vi messages — you only add app codes. Bridge to your existing i18n by providing a custom `resolver`. Drop the old `core-be` exception filter + manual translate calls.

## 6. Operator rename

`NOT_END_WIDTH` (typo in `core-be`) → `NOT_END_WITH` in `@sdcorejs/utils`. Find/replace across call sites:

```bash
grep -rE "NOT_END_WIDTH" src/ | wc -l   # before
sed -i 's/NOT_END_WIDTH/NOT_END_WITH/g' src/**/*.ts
```

## 7. Domain fields → consumer

Lib's `RequestContext` keeps only framework-generic keys: `userId, tenant, lang, token, user, permissions, request, response, custom`. (Note: `tenant`, NOT `tenantCode` — `tenant` is the framework-level identifier *value*; your entity column name is whatever you mark with `@Scoped()`.)

Domain values from `be-masterdata` (`departmentCode, project, internalSecret, username, fullName, isSystemAdmin, isTenantAdmin`) MUST move into your app.

**Option A — declaration merging** (type-safe):
```ts
declare module '@sdcorejs/nestjs/context' {
  interface RequestContext {
    departmentCode?: string;
    project?: string;
    isSystemAdmin?: boolean;
  }
}
```

**Option B — `customHeaders` + `ctx.custom`** (no compile-time types):
```ts
SdCoreModule.forRoot({
  context: {
    headers: {
      customHeaders: { departmentCode: 'x-department-code', project: 'x-project' },
    },
  },
});
// access: contextService.getCustom('departmentCode')
```

`DefaultAuditStrategy` no longer fills `creator/modifier` jsonb snapshots (username + fullName are domain). Subclass it:

```ts
@Injectable()
export class SdAuditStrategy extends DefaultAuditStrategy {
  onCreate(entity, ctx) {
    super.onCreate(entity, ctx);
    const u = ctx.user as { username?: string; fullName?: string } | undefined;
    if (u?.username && u?.fullName && ctx.userId) {
      entity.creator = { id: ctx.userId, username: u.username, fullName: u.fullName };
      entity.modifier = entity.creator;
    }
  }
}
```

## 8. Known gotchas

- **Mixin metadata**: TypeORM picks up columns from `WithAudit(BaseEntity)` because the mixin class still has decorators. If you see "Entity X is missing column Y" after migration, verify the mixin chain order matches the example: `WithAudit(BaseEntity)`, NOT `WithAudit(WithTimestamps(BaseEntity))` (which double-adds timestamps).
- **`AsyncLocalStorage` vs `cls-hooked`**: ALS preserves context across `await` chains automatically. Manual `session.run(...)` is now `contextService.run(store, fn)`. The cls-hooked `getNamespace` pattern is gone — use `ContextService` accessors.
- **`detail(id)` is tenancy-scoped**: unlike `core-be` (which fetched by id alone), `BaseRepository.detail(id)` injects the tenant scope into the `findOne` where-clause. A valid UUID belonging to another tenant returns `null`. If a flow relied on cross-tenant id fetches, route it through a `shouldBypass`-true context or a dedicated internal endpoint.
- **ActionHistory**: not yet abstracted. If you used `BaseRepository.options.logHistory = true`, that flag is parsed but no-op in `v0.1`. Wire your own subscriber or wait for `v0.2`.
- **FileStorage**: not in `v0.1`. Continue using the local `core-be/modules/file-storage` until the lib version ships.

## 9. Verification

```bash
npm run build       # type-check + compile
npm run test        # unit + integration
npm run test:e2e    # supertest against a real Nest app
```

If `BaseRepository` operations succeed in tests with `tenancy.strategy` registered and audit fields populate on create, the swap is complete.
