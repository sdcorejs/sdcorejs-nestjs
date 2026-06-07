# @sdcorejs/nestjs

> Neutral NestJS framework library — base classes plus the cross-cutting concerns every multi-tenant service re-implements (multi-tenancy, audit, permission, request context, cache, HTTP client, JWT/Keycloak, Zod validation, BullMQ queue). **Every domain specific is injected via DI strategies** — the library ships zero hardcoded column names. Extracted from `be-masterdata/core-be/` and refactored to be reusable across any NestJS 11 + TypeORM 0.3.x project.

**Status**: `1.0.0` — stable. Public API follows [Semantic Versioning](https://semver.org/).

---

## Table of contents

- [Installation](#installation)
- [Sub-paths](#sub-paths)
- [Quick start](#quick-start)
- [Multi-tenancy](#multi-tenancy)
- [Permissions](#permissions)
- [JWT / Keycloak authentication](#jwt--keycloak-authentication)
- [Internal (service-to-service) calls](#internal-service-to-service-calls)
- [Request context](#request-context)
- [ORM base classes](#orm-base-classes)
- [Validation (Zod v4)](#validation-zod-v4)
- [Internationalised errors](#internationalised-errors)
- [Philosophy](#philosophy)
- [License](#license)

---

## Installation

```bash
npm install @sdcorejs/nestjs @sdcorejs/utils
```

Peer dependencies (already in most NestJS projects):

- `@nestjs/common` `^11.0.0`
- `@nestjs/core` `^11.0.0`
- `@nestjs/passport` `^11.0.0`
- `typeorm` `^0.3.20`
- `reflect-metadata` `^0.2.0`
- `rxjs` `^7.8`
- `@sdcorejs/utils` `^1.1.0` (shared `Filter` / `PagingReq` / `Order` models + `ValidationUtilities`)

Optional peer dependencies — install only when you use the feature:

| Package | Enables |
|---|---|
| `ioredis` `^5` | redis cache backend (`@sdcorejs/nestjs/cache`) |
| `zod` `^4` | request validation (`@sdcorejs/nestjs/validation`) — **v4 only** |
| `jwks-rsa` `^3` + `jsonwebtoken` `^9` | Keycloak / OIDC JWKS verification (`@sdcorejs/nestjs/jwt`) |
| `passport` + `passport-jwt` | JWT auth strategies |
| `bullmq` `^5` + `@nestjs/bullmq` `^11` | background jobs (`@sdcorejs/nestjs/queue`) |

Engines: `node >=18.18`.

---

## Sub-paths

The package has multiple entry points; import only what you use.

| Import | What's inside |
|---|---|
| `@sdcorejs/nestjs` | `SdCoreModule.forRoot({...})` + ergonomic re-exports |
| `@sdcorejs/nestjs/orm` | `BaseEntity`, `WithTimestamps`, `WithAudit`, `BaseRepository`, `BaseService`, `BaseController`, `@TenantScoped`, `@SearchableFields`, `@Schema`, `apiError`/`ApiResponse`, types |
| `@sdcorejs/nestjs/context` | `ContextService` (AsyncLocalStorage), `ContextMiddleware`, `RequestContext`, header config |
| `@sdcorejs/nestjs/tenancy` | `ITenancyStrategy`, `TENANCY_STRATEGY`, `DefaultTenancyStrategy`, `buildScopeFilters`/`buildScopeWhere` helpers |
| `@sdcorejs/nestjs/audit` | `IAuditStrategy`, `AUDIT_STRATEGY`, `AuditSubscriber`, `DefaultAuditStrategy` |
| `@sdcorejs/nestjs/permission` | `IPermissionStrategy`, `AuthGuard`, `InternalGuard`, `@HasPermission`, `@HasAnyPermission`, `IInternalSecretProvider`, `IInternalContextEnricher` |
| `@sdcorejs/nestjs/cache` | `CacheService`, `CacheInterceptor`, `@Cached` (memory + redis backends) |
| `@sdcorejs/nestjs/http` | `HttpService` (axios-based, context-aware) |
| `@sdcorejs/nestjs/jwt` | `JwtModule`, `JwtStrategy` (symmetric), `KeycloakJwtStrategy` (JWKS/OIDC) |
| `@sdcorejs/nestjs/validation` | `ZodValidationGuard(schema \| map, source)`, `parseZod`, query presets (`zPaging`, `zUuid`, `zBool`), `ZodIssueDetail` (Zod **v4**) |
| `@sdcorejs/nestjs/queue` | `QueueModule`, `BaseWorker` (BullMQ + Redis) |
| `@sdcorejs/nestjs/i18n` | `II18nResolver`, `ILanguageResolver`, `SimpleI18nResolver`, `DefaultLanguageResolver`, `SdI18nExceptionFilter`, built-in en/vi `core.*` catalogs, `I18nModule` |
| `@sdcorejs/nestjs/action-history` | `ActionHistoryService`, `ActionHistoryEntity`, `ActionHistoryModule` — persists per-record audit trails (who changed what and when) |
| `@sdcorejs/nestjs/uploaded-file` | `UploadedFileService`, `AwsUploadedFileStorage`, `LocalUploadedFileStorage`, `UploadedFileModule` — file upload/download with local and S3-compatible backends |
| `@sdcorejs/nestjs/job-scheduler` | `JobSchedulerService`, `JobSchedulerEntity`, `JobSchedulerModule` — database-backed cron/job scheduling |
| `@sdcorejs/nestjs/entities` | All shipped TypeORM entities + `SD_CORE_ENTITIES` (`ActionHistory`, `JobScheduler`, `UploadedFile`) |

Register all library entities in one shot:

```ts
import { SD_CORE_ENTITIES } from '@sdcorejs/nestjs/entities';
TypeOrmModule.forRoot({ entities: [...SD_CORE_ENTITIES, /* your entities */] })
```

---

## Quick start

`SdCoreModule.forRoot({...})` composes every sub-module. Omitted keys fall back to no-op / default strategies (zero overhead, zero magic). JWT is opt-in — wired only when the `jwt` key is present.

```ts
// app.module.ts
import { Module } from '@nestjs/common';
import {
  SdCoreModule,
  INTERNAL_SECRET_PROVIDER,
  INTERNAL_CONTEXT_ENRICHER,
} from '@sdcorejs/nestjs';

@Module({
  imports: [
    SdCoreModule.forRoot({
      context:    { headers: { tenant: 'x-tenant', userId: 'x-user-id' } },
      tenancy:    { strategy: AppTenancyStrategy },
      audit:      { strategy: AppAuditStrategy },
      permission: { strategy: AppPermissionStrategy },
      cache:      { ttl: 60 },
      http:       { baseURL: process.env.UPSTREAM_API },
      jwt:        { jwks: { allowedIssuers: [process.env.KEYCLOAK_ISSUER!] } },
      i18n:       { fallbackLanguage: 'vi' }, // wires SdI18nExceptionFilter + en/vi core.* catalogs
      providers: [
        { provide: INTERNAL_SECRET_PROVIDER,  useClass: AppInternalSecretProvider },
        { provide: INTERNAL_CONTEXT_ENRICHER, useClass: AppInternalEnricher },
      ],
    }),
    // your domain modules...
  ],
})
export class AppModule {}
```

The `providers` array is a passthrough for consumer-side DI tokens; because `SdCoreModule` is global, those tokens resolve into the library's guards (e.g. `InternalGuard` picks up `INTERNAL_SECRET_PROVIDER`).

---

## Multi-tenancy

Tenancy is enforced by **your** `ITenancyStrategy`, injected before every query reaches the database. The library never knows your column names — you mark scoped columns with `@TenantScoped()` (decorator uses the **property name** as the column) and return scope values from the strategy.

### 1. Mark scoped columns on the entity

```ts
import { Entity, Column } from 'typeorm';
import { BaseEntity, WithAudit, TenantScoped } from '@sdcorejs/nestjs/orm';

@Entity()
export class Product extends WithAudit(BaseEntity) {
  @Column() name!: string;
  @Column() @TenantScoped() tenantCode!: string;
  @Column({ nullable: true }) @TenantScoped() departmentCode?: string;
}
```

### 2. Supply the scope via DI

```ts
import { Injectable } from '@nestjs/common';
import { ContextService } from '@sdcorejs/nestjs/context';
import type { ITenancyStrategy } from '@sdcorejs/nestjs/tenancy';
import type { RequestContext } from '@sdcorejs/nestjs/context';

@Injectable()
export class AppTenancyStrategy implements ITenancyStrategy {
  getCurrentScope(ctx: RequestContext): Record<string, unknown> {
    return {
      tenantCode: ctx.tenant,                       // scalar → EQUAL filter
      departmentCode: ctx.custom?.['departmentCodes'], // array → IN filter
    };
  }
  shouldBypass(ctx: RequestContext): boolean {
    return ctx.custom?.['isInternalCall'] === true; // admin / internal callers see everything
  }
}
```

### What the library does for you

When a strategy is registered, `BaseRepository`:

- **Reads** (`paging`, `all`, `search`, `detail`) — injects a scope filter per `@TenantScoped` column. A **scalar** scope value becomes `EQUAL`; an **array** becomes `IN` (multi-department users); `null` / `undefined` / empty array is skipped.
- **Writes** (`create`, `import`) — auto-fills the scoped columns from `getCurrentScope()`.
- **`detail(id)`** is scoped too — fetching a known UUID that belongs to another tenant returns `null` (no cross-tenant id leak).
- **`shouldBypass(ctx) === true`** skips both filter injection and auto-fill.

> With no strategy registered, the repository behaves as if tenancy is disabled — no overhead.

---

## Permissions

Permission codes are resolved by **your** `IPermissionStrategy.load(ctx)` once per request and cached. `AuthGuard` reads the route's `@HasPermission` / `@HasAnyPermission` metadata and enforces it.

```ts
import { Injectable } from '@nestjs/common';
import type { IPermissionStrategy } from '@sdcorejs/nestjs/permission';
import type { RequestContext } from '@sdcorejs/nestjs/context';

@Injectable()
export class AppPermissionStrategy implements IPermissionStrategy {
  constructor(private readonly pages: PagePermissionService) {}

  async load(ctx: RequestContext): Promise<string[]> {
    return this.pages.codesForUser(ctx.userId);
  }

  // Optional — override the default `Array.includes` to support wildcards / hierarchy.
  check(codes: string[], required: string): boolean {
    return codes.some((c) => c === required || (c.endsWith(':*') && required.startsWith(c.slice(0, -1))));
  }
}
```

Protect routes with decorators:

```ts
import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard, HasPermission, HasAnyPermission } from '@sdcorejs/nestjs/permission';

@Controller('products')
@UseGuards(AuthGuard)
export class ProductController {
  @Get()
  @HasPermission('product:read')
  list() { /* ... */ }

  @Get('export')
  @HasAnyPermission('product:export', 'product:admin')
  export() { /* ... */ }
}
```

`AuthGuard` syncs the authenticated `user` and the resolved `permissions` into `ContextService`, so any downstream service can call `contextService.hasPermission('product:read')` without re-loading.

---

## JWT / Keycloak authentication

`AuthGuard` extends `PassportAuthGuard('jwt')`, so you register a passport-jwt strategy via `JwtModule` (wired automatically by `SdCoreModule` when the `jwt` key is set).

### Keycloak / OIDC (asymmetric, JWKS)

Set `jwt.jwks` and `SdCoreModule` wires `KeycloakJwtStrategy`. The signing key is fetched per-token from the issuer's JWKS endpoint, so multiple realms / tenants (different `iss`) work with no shared secret. Requires `jwks-rsa` + `jsonwebtoken`.

```ts
SdCoreModule.forRoot({
  jwt: {
    jwks: {
      allowedIssuers: [process.env.KEYCLOAK_ISSUER!], // reject unknown issuers before any network call
      // jwksUriFromIssuer defaults to `${iss}/protocol/openid-connect/certs` (Keycloak)
    },
  },
});
```

To turn the verified token into your app's user, subclass and override `validate()`, then register it as the strategy:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { KeycloakJwtStrategy, JWT_CONFIG, type JwtConfig, type JwtPayload } from '@sdcorejs/nestjs/jwt';

@Injectable()
export class AppJwtStrategy extends KeycloakJwtStrategy {
  constructor(@Inject(JWT_CONFIG) cfg: JwtConfig, private readonly users: UserService) {
    super(cfg);
  }
  async validate(payload: JwtPayload) {
    return {
      id: payload.sub,
      email: payload.email,
      roles: (payload.realm_access as { roles?: string[] })?.roles ?? [],
    };
  }
}

// register the subclass:
SdCoreModule.forRoot({
  jwt: { jwks: { allowedIssuers: [process.env.KEYCLOAK_ISSUER!] } },
});
// then pass it through JwtModule options when you need constructor deps:
//   JwtModule.forRoot(config, { strategy: AppJwtStrategy, imports: [UserModule] })
```

The object returned from `validate()` becomes `req.user` and is mirrored into `ContextService.user` by `AuthGuard`.

### Symmetric secret (HS*)

Omit `jwks` and pass a `secret` — `SdCoreModule` wires the symmetric `JwtStrategy`:

```ts
SdCoreModule.forRoot({ jwt: { secret: process.env.JWT_SECRET! } });
```

---

## Internal (service-to-service) calls

`InternalGuard` gates internal-only endpoints with a shared secret in the `X-Internal-Secret` header, compared in constant time. Two DI hooks make it production-ready:

### 1. Provide the secret — `IInternalSecretProvider`

```ts
import { Injectable } from '@nestjs/common';
import type { IInternalSecretProvider } from '@sdcorejs/nestjs/permission';

@Injectable()
export class AppInternalSecretProvider implements IInternalSecretProvider {
  getKey(): string {
    return process.env.INTERNAL_SECRET!;
  }
  // Optional — zero-downtime rotation: return BOTH the outgoing and incoming secret during
  // the transition window. When present, the guard accepts a match against ANY key.
  getKeys(): string[] {
    return [process.env.INTERNAL_SECRET!, process.env.INTERNAL_SECRET_NEXT!].filter(Boolean);
  }
}
```

### 2. Carry trusted context — `IInternalContextEnricher` (optional)

Internal calls arrive with no authenticated user. The enricher runs **only after the secret check passes**, so context derived from inbound headers is trusted on verified internal traffic and never on public traffic.

```ts
import { Injectable } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import { ContextService } from '@sdcorejs/nestjs/context';
import type { IInternalContextEnricher } from '@sdcorejs/nestjs/permission';

@Injectable()
export class AppInternalEnricher implements IInternalContextEnricher {
  constructor(private readonly ctx: ContextService) {}
  enrich(req: IncomingMessage): void {
    const h = req.headers;
    this.ctx.set('tenant', h['x-tenant'] as string);
    this.ctx.set('userId', h['x-user-id'] as string);
    this.ctx.set('custom', { isInternalCall: true, caller: h['x-caller'] });
  }
}
```

Apply per route:

```ts
import { Controller, Post, UseGuards } from '@nestjs/common';
import { InternalGuard } from '@sdcorejs/nestjs/permission';

@Controller('internal/sync')
@UseGuards(InternalGuard)
export class SyncController { /* ... */ }
```

Register both providers via `SdCoreModule.forRoot({ providers: [...] })` (see [Quick start](#quick-start)). With no secret provider registered, the guard throws `500` at request time (not at boot), keeping the DI graph bootable.

> The enricher sets `custom.isInternalCall`, which your `ITenancyStrategy.shouldBypass()` can read to skip tenant filtering on internal calls.

---

## Request context

`ContextService` is an `AsyncLocalStorage`-backed singleton — per-request isolation without request-scoped DI. `ContextMiddleware` populates it from headers.

| Accessor | Source |
|---|---|
| `userId` | `x-user-id` header / JWT |
| `tenant` | `x-tenant` header |
| `lang` | `accept-language` / `x-language` (raw string; consumer parses to a locale) |
| `token`, `user`, `permissions` | filled by `AuthGuard` after JWT validation |
| `hasPermission(code)` | checks the synced `permissions` set |
| `getCustom<T>(key)` | reads a consumer value from `ctx.custom` |

The library keeps only framework-generic keys. Domain values go in `ctx.custom`, or add typed fields via declaration merging:

```ts
declare module '@sdcorejs/nestjs/context' {
  interface RequestContext {
    departmentCode?: string;
    isSystemAdmin?: boolean;
  }
}
```

---

## ORM base classes

`BaseController` → `BaseService` → `BaseRepository`, parameterized by entity `T` and DTO `TDto`.

```ts
// repository.ts
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseRepository } from '@sdcorejs/nestjs/orm';

@Injectable()
export class ProductRepository extends BaseRepository<Product> {
  constructor(ds: DataSource, /* inject strategies + ContextService via options */) {
    super(Product, ds, { /* tenancyStrategy, auditStrategy, contextService */ });
  }
}
```

`BaseController` mounts the standard endpoint set:

| Method | Route | Service call |
|---|---|---|
| POST | `/search` | `search(keyword, filters)` |
| POST | `/paging` | `paging(req)` |
| GET | `/all` | `all()` |
| GET | `/:id` | `detail(id)` (tenancy-scoped) |
| DELETE | `/:id` | `delete(id)` |

`@SearchableFields({ exact, contain, activeColumn })` configures the `search` endpoint; `@Schema` adds DTO introspection metadata.

---

## Validation (Zod v4)

> Requires `zod@^4`. Zod v3 is not supported (issue shape differs).

`ZodValidationGuard` validates `request[source]` and replaces the raw input with the coerced value. Set each field's message to an i18n **code** — the i18n layer localizes it.

```ts
import { z } from 'zod';
import { UseGuards } from '@nestjs/common';
import { AuthGuard } from '@sdcorejs/nestjs/permission';
import { ZodValidationGuard, zPaging } from '@sdcorejs/nestjs/validation';

const CreateProduct = z.object({
  name: z.string().min(3, 'core.product.name.min'),
  price: z.coerce.number().positive('core.product.price.positive'),
});

// single source
@UseGuards(AuthGuard, ZodValidationGuard(CreateProduct))
@Post() create(@Body() dto: z.infer<typeof CreateProduct>) {}

// multiple sources at once — issues from every part merge into one envelope
@UseGuards(AuthGuard, ZodValidationGuard({ body: CreateProduct, query: zPaging }))
@Post('search') search() {}
```

- **Guard order**: place AFTER `AuthGuard` so unauthenticated requests never reach validation.
- **Query presets** (params arrive as strings): `zPaging` (`{ pageNumber, pageSize }` matching `BaseRepository` caps), `zUuid(msgCode?)`, `zBool` (`'true'`/`'1'`/`'yes'` → `true`).
- **Issue params**: each `ZodIssueDetail` carries `{ path, message, code, params? }`. `params` holds JSON-safe interpolation vars (`minimum`, `maximum`, `format`, `expected`, …) so the i18n layer can render "must be at least {minimum}".
- Failures throw `BadRequestException(apiError('core.validation.failed', …, { issues }))`.

Express 5 note: `query` / `params` are getter-only, so the guard mutates them in place; `body` is reassigned.

---

## Internationalised errors

Producers across the library throw i18n **codes**, not sentences:

```ts
import { apiError } from '@sdcorejs/nestjs/orm';
throw new BadRequestException(apiError('core.validation.failed', 'Validation failed', { issues }));
```

`@sdcorejs/nestjs/i18n` closes the loop end-to-end:

- **`SdI18nExceptionFilter`** — catches `HttpException`s carrying an `apiError` body, localizes `message` via the resolver using the request's `ctx.lang`, emits the `{ error: { code, message, data } }` envelope. `code` is preserved for client-side handling.
- **`SimpleI18nResolver`** — catalog lookup `catalogs[lang][code] → catalogs[fallback][code] → code`, with `{var}` interpolation from `data` (+ Zod issue `params`). For ICU / plurals, implement a custom `II18nResolver`.
- **`DefaultLanguageResolver`** — parses the raw `Accept-Language` header (`vi-VN,vi;q=0.9,en;q=0.8`) to a supported base code, q-sorted, with fallback.
- **Built-in catalogs** — en + vi messages for every `core.*` code the library throws, shipped in `CORE_CATALOGS`. Merge your app's catalog over them.

Enable via the `i18n` key (opt-in — omit to leave envelopes untranslated):

```ts
SdCoreModule.forRoot({
  i18n: {
    fallbackLanguage: 'vi',
    supportedLanguages: ['en', 'vi'],
    catalogs: {                      // merged OVER built-in core.* (consumer wins)
      vi: { 'app.product.name.min': 'Tên phải có ít nhất {minimum} ký tự' },
    },
    // resolver: MyIcuResolver,       // optional: replace SimpleI18nResolver entirely
    // useGlobalFilter: false,        // optional: skip the global APP_FILTER
  },
});
```

`ApiResponse.ok(data)` / `ApiResponse.noContent()` wrap successful responses.

---

## Philosophy

- **Fully neutral** — no `tenantCode`/`departmentCode` hardcoded; consumer chooses column names via `@TenantScoped()` and writes its own strategies.
- **Strategies are DI tokens, not subclassing** — each concern defines an interface + a `*_STRATEGY` symbol + a `Default*` no-op fallback.
- **No prototype pollution** — no `String.isUuid()` / `Array.prototype.distinct()`; use the exported helpers.
- **TypeORM 0.3.x bound** — no ORM abstraction; the library leans into TypeORM directly.
- **Bilingual errors** — throw i18n codes, not sentences.
- **TDD, high coverage** — every behavior ships with a spec; release is blocked under the coverage threshold.
- **Dual ESM + CJS** — the `exports` field maps both formats per sub-path.

See [docs/migration-from-core-be.md](./docs/migration-from-core-be.md) for porting an existing `core-be` app.

---

## License

[MIT](./LICENSE) © 2026 Trần Thuận Nghĩa
