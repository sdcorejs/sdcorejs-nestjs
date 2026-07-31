# @sdcorejs/nestjs

[![npm version](https://img.shields.io/npm/v/@sdcorejs/nestjs.svg?logo=npm&color=crimson)](https://www.npmjs.com/package/@sdcorejs/nestjs)
[![node](https://img.shields.io/node/v/@sdcorejs/nestjs.svg?label=node)](https://nodejs.org)
[![license](https://img.shields.io/npm/l/@sdcorejs/nestjs.svg)](./LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/sdcorejs/sdcorejs-nestjs/ci.yml?label=CI&logo=github)](https://github.com/sdcorejs/sdcorejs-nestjs/actions)
[![coverage](https://img.shields.io/badge/coverage-93%25-brightgreen)](https://github.com/sdcorejs/sdcorejs-nestjs)
[![peer: NestJS 11](https://img.shields.io/badge/peer-NestJS%2011-E0234E?logo=nestjs)](https://nestjs.com)

> Neutral NestJS framework library — base classes plus the cross-cutting concerns every multi-tenant service re-implements: multi-tenancy, audit, permission, request context, cache, HTTP client, JWT/Keycloak, Zod validation, BullMQ queue, i18n. The neutral core accepts application scope names through DI strategies; the stateful `UploadedFile` and `ActionHistory` features use their documented `tenantCode` schemas.

Public versions are managed with Changesets. Compatibility-impacting changes are called out in the
release notes and migration guides; the 1.1.0 line requires Node.js 20+ and an explicit migration of
existing applications.

📖 **Documentation portal**:
[Getting started](https://sdcorejs.github.io/sdcorejs-nestjs/guide/getting-started) ·
[API reference](https://sdcorejs.github.io/sdcorejs-nestjs/api/) ·
[Complete examples](https://sdcorejs.github.io/sdcorejs-nestjs/examples/) ·
[Security checklist](https://sdcorejs.github.io/sdcorejs-nestjs/reference/security) ·
[1.1.0 migration](https://sdcorejs.github.io/sdcorejs-nestjs/migrations/1.0-to-1.1)

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
- [HTTP propagation and cache isolation](#http-propagation-and-cache-isolation)
- [ORM base classes](#orm-base-classes)
- [Validation (Zod v4)](#validation-zod-v4)
- [Internationalised errors](#internationalised-errors)
- [Background jobs (BullMQ)](#background-jobs-bullmq)
- [Features](#features)
- [Security and migration](#security-and-migration)
- [Philosophy](#philosophy)
- [License](#license)

---

## Installation

```bash
npm install @sdcorejs/nestjs
```

### Peer dependencies

Only **two** — every NestJS app already has them:

| Package          | Version   |
| ---------------- | --------- |
| `@nestjs/common` | `^11.0.0` |
| `@nestjs/core`   | `^11.0.0` |

They stay peers so the library shares your app's DI container (one NestJS instance, no duplicated injectors).

### Bundled (`dependencies`)

Installed automatically with the package — you never add these yourself:

| Package                          | Purpose                                                         |
| -------------------------------- | --------------------------------------------------------------- |
| `@nestjs/passport` `^11`         | Passport integration                                            |
| `@nestjs/typeorm` `^11`          | TypeORM module                                                  |
| `@nestjs/bullmq` `^11`           | BullMQ queue module                                             |
| `@nestjs/schedule` `^6`          | `@Cron` for file cleanup                                        |
| `@nestjs/platform-express` `^11` | `FileInterceptor`                                               |
| `typeorm` `^0.3`                 | ORM core                                                        |
| `reflect-metadata` `^0.2`        | Decorator metadata                                              |
| `rxjs` `^7.8`                    | RxJS                                                            |
| `@sdcorejs/utils` `^1.1`         | `Filter` / `PagingReq` / `Order` models + `ValidationUtilities` |
| `axios` `^1.18`                  | HTTP client                                                     |
| `bullmq` `^5`                    | BullMQ core                                                     |
| `passport` `^0.7`                | Passport                                                        |
| `passport-jwt` `^4`              | JWT passport strategy                                           |
| `zod` `^4`                       | Root and `/validation` request validation APIs                  |

> `typeorm` and `reflect-metadata` are singletons — npm hoists a single copy when your app's versions
> are compatible (the whole NestJS 11 ecosystem is on `typeorm@^0.3` / `reflect-metadata@^0.2`).

### Optional (`optionalDependencies`)

Auto-installed, but a failed install won't break your project. Skip with `--omit=optional` if unused:

| Package              | Version   | Enables                                            |
| -------------------- | --------- | -------------------------------------------------- |
| `ioredis`            | `^5`      | Redis cache backend (`/services`)                  |
| `jwks-rsa`           | `^4`      | Keycloak / OIDC JWKS key verification (`/auth`)    |
| `jsonwebtoken`       | `^9`      | JWT decode + verify (`/auth`)                      |
| `@aws-sdk/client-s3` | `^3.1090` | S3 storage driver for uploaded files (`/features`) |

Engines: `node >=20` (Node.js 20 and 22 are tested in CI; NestJS 11 does not support Node.js 18).

---

## Sub-paths

The package has multiple entry points; import only what you use.

| Import                        | What's inside                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@sdcorejs/nestjs`            | `SdCoreModule.forRoot({...})` + commonly used ergonomic exports. Treat the grouped sub-paths below as the canonical public API for feature-specific imports.                                                                                                                                                                                                                                                                        |
| `@sdcorejs/nestjs/core`       | ORM base classes (`BaseEntity`, `WithTimestamps`, `WithAudit`, `BaseRepository`, `BaseService`, `BaseController`, `@Scoped`, `@SearchableFields`, `@Schema`, `apiError`/`ApiResponse`), request context (`ContextService`, `ContextMiddleware`, `RequestContext`), multi-tenancy (`ITenancyStrategy`, `TENANCY_STRATEGY`, `buildScopeFilters`/`buildScopeWhere`), and audit (`IAuditStrategy`, `AUDIT_STRATEGY`, `AuditSubscriber`) |
| `@sdcorejs/nestjs/auth`       | JWT / Keycloak strategies (`JwtModule`, `JwtStrategy`, `KeycloakJwtStrategy`, `JWT_CONFIG`), plus permission enforcement (`IPermissionStrategy`, `AuthGuard`, `InternalGuard`, `@HasPermission`, `@HasAnyPermission`, `IInternalSecretProvider`, `IInternalContextEnricher`)                                                                                                                                                        |
| `@sdcorejs/nestjs/services`   | HTTP client (`HttpService`, axios-based, context-aware) + cache (`CacheService`, `CacheInterceptor`, `@Cached` — memory and redis backends)                                                                                                                                                                                                                                                                                         |
| `@sdcorejs/nestjs/queue`      | `QueueModule`, `SdWorkerHost` (BullMQ + Redis) + re-exported `Processor`/`InjectQueue`/`Job`/`Queue`                                                                                                                                                                                                                                                                                                                                |
| `@sdcorejs/nestjs/validation` | `ZodValidationGuard(schema \| map, source)`, `parseZod`, query presets (`zPaging`, `zUuid`, `zBool`), `ZodIssueDetail` (Zod **v4**)                                                                                                                                                                                                                                                                                                 |
| `@sdcorejs/nestjs/i18n`       | `II18nResolver`, `ILanguageResolver`, `SimpleI18nResolver`, `DefaultLanguageResolver`, `SdI18nExceptionFilter`, built-in en/vi `core.*` catalogs, `I18nModule`                                                                                                                                                                                                                                                                      |
| `@sdcorejs/nestjs/features`   | Stateful feature modules — `ActionHistory`, `JobScheduler`, `UploadedFile` (entity + service + module each), plus drop-in `UploadedFileController` / `ActionHistoryController`                                                                                                                                                                                                                                                      |

---

## Quick start

`SdCoreModule.forRoot({...})` is the **single import** that composes every sub-module.
Always-on: context, tenancy, audit, permission, cache, HTTP client.
Opt-in (wired only when the config key is present): `jwt`, `i18n`, `uploadedFile`, `actionHistory`, `jobScheduler`, `queue`.

```ts
// app.module.ts
import { Module } from '@nestjs/common';
import { SdCoreModule } from '@sdcorejs/nestjs';
import { TypeOrmModule } from '@nestjs/typeorm';
import { z } from 'zod';

const AppClaimsSchema = z.object({
  sub: z.string().min(1),
  tenant: z.string().min(1),
  roles: z.array(z.string().min(1)).optional(),
  permissions: z.array(z.string().min(1)).optional(),
});

@Module({
  imports: [
    SdCoreModule.forRoot({
      context: {
        identity: {
          principalResolver: (principal: unknown) => {
            const claims = AppClaimsSchema.parse(principal);
            return {
              userId: claims.sub,
              tenant: claims.tenant,
              roles: claims.roles ?? [],
              permissions: claims.permissions ?? [],
            };
          },
        },
      },
      cache: {},
      // Built-in secret provider — reads process.env[envVar] at request time.
      internalSecret: { envVar: 'INTERNAL_SECRET_KEY' },
      tenancy: {
        resolve: (rc) => ({
          tenantCode: rc.tenant,
          departmentCode: rc.custom?.departmentCode,
        }),
      },
      jwt: { jwks: { allowedIssuers: [process.env.KEYCLOAK_ISSUER!] } },
    }),
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.DATABASE_URL,
      autoLoadEntities: true,
      synchronize: false,
    }),
  ],
})
export class AppModule {}
```

This minimal configuration uses the built-in permission strategy and enables no stateful feature.
See the compile-checked [complete application](https://github.com/sdcorejs/sdcorejs-nestjs/tree/main/examples) for custom permissions,
cache interception, validation, HTTP propagation, files, history, scheduler, queue, and tests.

> **`tenancy` strategy vs. callbacks** — pass `{ strategy: MyTenancyStrategy }` to supply a full
> DI-injected class, or use inline `{ resolve, bypassGrant }` callbacks. Legacy boolean bypasses
> cannot grant cross-tenant access.

> **Internal secret** — `internalSecret: { envVar: 'INTERNAL_SECRET_KEY' }` wires the built-in `EnvInternalSecretProvider`. To rotate secrets, implement `IInternalSecretProvider` yourself and register it via `providers: [{ provide: INTERNAL_SECRET_PROVIDER, useClass: ... }]`.

> `internalSecret: { key: '...' }` is deprecated and intended only for isolated development/tests.
> Never commit or deploy a static literal secret; load production secrets at runtime instead.

> **Feature entities** — `UploadedFile`, `ActionHistory`, `JobScheduler` export from `@sdcorejs/nestjs/features`. Register them with TypeORM via `autoLoadEntities: true` or by listing them explicitly.

---

## Multi-tenancy

Tenancy is enforced by **your** `ITenancyStrategy`, injected before every query reaches the database. The library never knows your column names — you mark scoped columns with `@Scoped()` (decorator uses the **property name** as the column) and return scope values from the strategy.

### 1. Mark scoped columns on the entity

```ts
import { Entity, Column } from 'typeorm';
import { BaseEntity, WithAudit, Scoped } from '@sdcorejs/nestjs/core';

@Entity()
export class Product extends WithAudit(BaseEntity) {
  @Column() name!: string;
  @Column() @Scoped() tenantCode!: string;
  @Column({ nullable: true }) @Scoped({ required: false }) departmentCode?: string;
}
```

### 2. Supply the scope via DI

```ts
import { Injectable } from '@nestjs/common';
import { ContextService } from '@sdcorejs/nestjs/core';
import type { ITenancyStrategy } from '@sdcorejs/nestjs/core';
import type { RequestContext } from '@sdcorejs/nestjs/core';

@Injectable()
export class AppTenancyStrategy implements ITenancyStrategy {
  getCurrentScope(ctx: RequestContext): Record<string, unknown> {
    return {
      tenantCode: ctx.tenant,
      departmentCode: ctx.custom?.['departmentCodes'],
    };
  }
  getBypassGrant(ctx: RequestContext) {
    if (!ctx.userId || !ctx.roles?.includes('platform-admin')) return undefined;
    return {
      authorized: true as const,
      actorId: ctx.userId,
      reason: 'approved cross-tenant maintenance',
      allowedTargets: ['product'], // dataSource.getMetadata(Product).tablePath
      allowedOperations: ['read'],
      audit: (event) => privilegedAuditSink.writeSync(event),
    };
  }
}
```

The audit callback must persist synchronously and return `void`; Promise/thenable results are
rejected so a bypass cannot proceed before its audit record is durable.

### What the library does for you

For every entity with `@Scoped()` columns, `BaseRepository`:

- Applies the same canonical scope to reads, counts, relation queries, creates, imports, updates,
  deletes, soft deletes, restores, and batches. Mutation predicates and tenant predicates execute in
  the same SQL statement, and partial batches are rejected.
- Treats `@Scoped()` as required. A null/undefined required value throws
  `MissingTenancyScopeError`; blank strings and invalid `Date` values throw
  `InvalidTenancyScopeError`. An empty allowed-values array matches zero rows. Use
  `@Scoped({ required: false })` only deliberately.
- Auto-fills scopes on create/import and rejects ordinary updates that try to move a row between
  tenants or other scope dimensions.
- Fails closed when a scoped entity has no registered strategy. Entities without scoped columns keep
  normal TypeORM behavior.
- Accepts only a structured `TenancyBypassGrant` with actor, reason, exact entity/operation
  allowlists, authorization, and a mandatory synchronous audit callback. A legacy boolean `true`
  bypass is rejected.

Bypass target names are the stable, schema-qualified `EntityMetadata.tablePath` values resolved by
TypeORM, not entity class names. This prevents same-named entities in different schemas from sharing
a grant accidentally.

Raw TypeORM access is available only through visibly dangerous escape hatches:
`unsafeRepository`, `unsafeGetRepository()`, and `unsafeCreateQueryRunner()`. These bypass all scope
and affected-row protection; keep them inside reviewed maintenance code.

---

## Permissions

Permission codes are resolved by **your** `IPermissionStrategy.load(ctx)` once per request and cached. `AuthGuard` reads the route's `@HasPermission` / `@HasAnyPermission` metadata and enforces it.

```ts
import { Injectable } from '@nestjs/common';
import type { IPermissionStrategy } from '@sdcorejs/nestjs/auth';
import type { RequestContext } from '@sdcorejs/nestjs/core';

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
import { AuthGuard, HasPermission, HasAnyPermission } from '@sdcorejs/nestjs/auth';

@Controller('products')
@UseGuards(AuthGuard)
export class ProductController {
  @Get()
  @HasPermission('product:read')
  list() {
    /* ... */
  }

  @Get('export')
  @HasAnyPermission('product:export', 'product:admin')
  export() {
    /* ... */
  }
}
```

`AuthGuard` syncs the authenticated `user` and the resolved `permissions` into `ContextService`, so any downstream service can call `contextService.hasPermission('product:read')` without re-loading.

---

## JWT / Keycloak authentication

`AuthGuard` extends `PassportAuthGuard('jwt')`, so you register a passport-jwt strategy via `JwtModule` (wired automatically by `SdCoreModule` when the `jwt` key is set).

### Keycloak / OIDC (asymmetric, JWKS)

Set `jwt.jwks` and `SdCoreModule` wires `KeycloakJwtStrategy`. The signing key is fetched per-token from the issuer's JWKS endpoint, so multiple realms / tenants (different `iss`) work with no shared secret. Requires `jwks-rsa@^4` + `jsonwebtoken@^9`.

```ts
SdCoreModule.forRoot({
  jwt: {
    jwks: {
      allowedIssuers: [process.env.KEYCLOAK_ISSUER!], // exact-match list for static, known realms
      // jwksUriFromIssuer defaults to `${iss}/protocol/openid-connect/certs` (Keycloak)
    },
  },
});
```

> **An issuer policy is required** — set at least one of `allowedIssuers`, `allowedIssuerHosts`, or
> `issuerValidator` (the strategy throws otherwise; without it the JWKS would be fetched from any
> token-supplied `iss` → spoofing + SSRF). For **dynamic multi-realm** (realms created at runtime), pin
> the Keycloak origin instead of listing realms: `allowedIssuerHosts: ['https://kc.example.com']`
> accepts any realm under that host and keeps JWKS fetches on that host. Use `issuerValidator(iss)` for
> custom rules.

To turn the verified token into your app's user, subclass and override `validate()`, then register it as the strategy:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { KeycloakJwtStrategy, JWT_CONFIG, type JwtConfig, type JwtPayload } from '@sdcorejs/nestjs/auth';

@Injectable()
export class AppJwtStrategy extends KeycloakJwtStrategy {
  constructor(
    @Inject(JWT_CONFIG) cfg: JwtConfig,
    private readonly users: UserService,
  ) {
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

### Symmetric secret (HS\*)

Omit `jwks` and pass a `secret` — `SdCoreModule` wires the symmetric `JwtStrategy`:

```ts
SdCoreModule.forRoot({ jwt: { secret: process.env.JWT_SECRET! } });
```

`secret` and `jwks` are mutually exclusive and fail fast when both are supplied. In both modes,
`cookieName` adds a cookie fallback after bearer-token extraction; the host HTTP adapter must parse
cookies. `expiresIn` is deprecated because these strategies verify tokens and never issue them.

---

## Internal (service-to-service) calls

`InternalGuard` gates internal-only endpoints with a shared secret in the `X-Internal-Secret` header, compared in constant time. Two DI hooks make it production-ready:

### 1. Provide the secret — `IInternalSecretProvider`

```ts
import { Injectable } from '@nestjs/common';
import type { IInternalSecretProvider } from '@sdcorejs/nestjs/auth';

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
import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import { ContextService } from '@sdcorejs/nestjs/core';
import type { IInternalContextEnricher } from '@sdcorejs/nestjs/auth';

function requiredIdentityHeader(value: string | string[] | undefined, name: string): string {
  if (typeof value !== 'string') throw new UnauthorizedException(`Missing ${name}`);
  const normalized = value.trim();
  if (!normalized || normalized.length > 64 || !/^[A-Za-z0-9._:-]+$/.test(normalized)) {
    throw new UnauthorizedException(`Invalid ${name}`);
  }
  return normalized;
}

@Injectable()
export class AppInternalEnricher implements IInternalContextEnricher {
  constructor(private readonly ctx: ContextService) {}
  enrich(req: IncomingMessage): void {
    const h = req.headers;
    const tenant = requiredIdentityHeader(h['x-tenant'], 'x-tenant');
    const userId = requiredIdentityHeader(h['x-user-id'], 'x-user-id');
    const caller = requiredIdentityHeader(h['x-caller'], 'x-caller');
    this.ctx.set('tenant', tenant);
    this.ctx.set('userId', userId);
    this.ctx.set('custom', { isInternalCall: true, caller });
  }
}
```

Apply per route:

```ts
import { Controller, Post, UseGuards } from '@nestjs/common';
import { InternalGuard } from '@sdcorejs/nestjs/auth';

@Controller('internal/sync')
@UseGuards(InternalGuard)
export class SyncController {
  /* ... */
}
```

Register both providers via `SdCoreModule.forRoot({ providers: [...] })` (see [Quick start](#quick-start)). With no secret provider registered, the guard throws `500` at request time (not at boot), keeping the DI graph bootable.

> Internal authentication does not automatically bypass tenancy. A privileged internal caller still
> needs a verified identity, explicit authorization, and an audited `TenancyBypassGrant`.

---

## Request context

`ContextService` is an `AsyncLocalStorage`-backed singleton: per-request isolation without
request-scoped DI. Security-sensitive identity headers are ignored by default. `AuthGuard` derives
tenant/user/roles/permissions from the verified Passport principal, using
`context.identity.principalResolver` when the claim shape is application-specific.

| Accessor                                            | Source                                                                     |
| --------------------------------------------------- | -------------------------------------------------------------------------- |
| `userId`, `tenant`, `roles`                         | verified principal; or explicitly verified gateway headers                 |
| `lang`                                              | `accept-language` / `x-language` (raw string; consumer parses to a locale) |
| `token`, `user`, `permissions`, `permissionVersion` | filled/synchronized after JWT validation                                   |
| `identitySource`                                    | `verified-principal` or `trusted-headers`                                  |
| `hasPermission(code)`                               | checks the synced `permissions` set                                        |
| `getCustom<T>(key)`                                 | reads a consumer value from `ctx.custom`                                   |

Trusted-header mode requires an explicit verifier:

```ts
context: {
  headers: { tenant: 'x-tenant', userId: 'x-user-id' },
  identity: {
    trustedHeaders: {
      isTrustedRequest: (request) => verifyGatewayBoundary(request),
    },
  },
}
```

The gateway must strip all client-supplied identity headers before setting trusted values. A
conflict between trusted gateway identity and verified JWT identity fails authentication.

The library keeps only framework-generic keys. Domain values go in `ctx.custom`, or add typed fields via declaration merging:

```ts
declare module '@sdcorejs/nestjs/core' {
  interface RequestContext {
    departmentCode?: string;
    isSystemAdmin?: boolean;
  }
}
```

---

## HTTP propagation and cache isolation

`HttpService` propagates configured identity headers only to exact HTTP(S) origins in
`http.trustedOrigins`. Propagation is disabled by default. Caller-supplied identity headers are
removed before trusted values are rebuilt from request context, and are stripped from untrusted
absolute URLs and redirect targets. `Authorization` remains caller-owned; `x-internal-secret` is
retained only for a trusted origin and is stripped before external requests or redirects.

Every cached handler declares its security boundary explicitly:

```ts
@Cached({ scope: 'tenant', ttl: 60 })
listTenantData() {}

@Cached({
  scope: 'user',
  ttl: 30,
  keyResolver: ({ query }) => query, // strict HTTP descriptor; business suffix only
})
listPrivateData() {}
```

`@Cached()` stores metadata; register the interceptor before expecting cache behavior:

```ts
import { APP_INTERCEPTOR } from '@nestjs/core';
import { CacheInterceptor } from '@sdcorejs/nestjs/services';

@Module({ providers: [{ provide: APP_INTERCEPTOR, useClass: CacheInterceptor }] })
export class AppModule {}
```

Tenant/user namespaces automatically fingerprint every JSON-safe own domain/security context field,
including values in `custom` and consumer declaration-merged top-level fields. Runtime
`request`/`response` references and `token`/`user` credentials are excluded. Roles and permissions
are sorted before fingerprinting; tenant scope alone excludes `userId` so explicitly tenant-shared
results remain shared. A custom resolver receives a strict header-free HTTP descriptor plus the
method name and cannot remove that namespace. If required identity is missing, or the context or
request descriptor is circular, accessor-backed, non-JSON-safe, or otherwise unsafe, caching is
bypassed safely.
`scope: 'global'` is an explicit opt-in only for responses identical across every tenant, user,
locale, and permission state. Single-flight cache loading remains enabled.

Select Redis explicitly and give every application/environment/release its own prefix:

```ts
cache: {
  backend: 'redis',
  redis: {
    host: 'redis.internal',
    keyPrefix: 'orders:prod:v2:',
  },
},
```

There is no shared default prefix. `keyPrefix` is required, nonblank, and must not contain Redis
glob metacharacters (`*`, `?`, `[`, `]`, or `\\`); invalid configuration fails fast rather than
silently selecting a shared namespace. On a shared Redis database, `clear()` and `size()` scan only
that prefix. Use a release-versioned prefix when cache-key semantics change and expire or remove
only your application's old prefix.

---

## ORM base classes

`BaseController` → `BaseService` → `BaseRepository`, parameterized by entity `T` and DTO `TDto`.

```ts
// repository.ts
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseRepository } from '@sdcorejs/nestjs/core';

@Injectable()
export class ProductRepository extends BaseRepository<Product> {
  constructor(ds: DataSource /* inject strategies + ContextService via options */) {
    super(Product, ds, {/* tenancyStrategy, auditStrategy, contextService */});
  }
}
```

`BaseController` mounts the standard endpoint set:

| Method | Route     | Service call                                 |
| ------ | --------- | -------------------------------------------- |
| POST   | `/search` | `search(keyword, filters)`                   |
| POST   | `/paging` | `paging(req)` — `pageSize` capped at **200** |
| GET    | `/:id`    | `detail(id)` (tenancy-scoped)                |
| DELETE | `/:id`    | `delete(id)`                                 |

`detail(id)` excludes soft-deleted rows by default; repository callers must pass
`{ withDeleted: true }` explicitly to include them. Paging is zero-based (`pageNumber: 0` is the
first page), defaults to 10 rows, and caps `pageSize` at 200. `all()` (unbounded full-table read),
`pagingDeleted`, soft-delete and restore live on `BaseService`/`BaseRepository` but are **not**
exposed by the controller — add an endpoint only for a reviewed resource. The exact default HTTP
statuses/envelopes are listed in the
[REST reference](https://sdcorejs.github.io/sdcorejs-nestjs/reference/rest-endpoints).

---

## Validation (Zod v4)

> The package installs `zod@^4`; Zod v3 is not supported because its issue shape differs.

`ZodValidationGuard` validates `request[source]` and replaces the raw input with the coerced value. Set each field's message to an i18n **code** — the i18n layer localizes it.

```ts
import { z } from 'zod';
import { UseGuards } from '@nestjs/common';
import { AuthGuard } from '@sdcorejs/nestjs/auth';
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
import { apiError } from '@sdcorejs/nestjs/core';
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
    catalogs: {
      // merged OVER built-in core.* (consumer wins)
      vi: { 'app.product.name.min': 'Tên phải có ít nhất {minimum} ký tự' },
    },
    // resolver: MyIcuResolver,       // optional: replace SimpleI18nResolver entirely
    // useGlobalFilter: false,        // optional: skip the global APP_FILTER
  },
});
```

`ApiResponse.ok(data)` / `ApiResponse.noContent()` wrap successful responses.

---

## Background jobs (BullMQ)

`@sdcorejs/nestjs/queue` wraps `@nestjs/bullmq` with one shared Redis connection + production job
defaults (`attempts: 3`, exponential backoff, bounded `removeOnComplete`/`removeOnFail`). Import every
primitive from this one entry — `QueueModule`, `SdWorkerHost`, and the re-exported `Processor` /
`InjectQueue` / `Job` / `Queue`.

```ts
// 1. open the connection (or via SdCoreModule.forRoot({ queue: { connection } }))
@Module({ imports: [QueueModule.forRoot({ connection: { host: 'localhost', port: 6379, db: 1 } })] })
export class AppModule {}

// 2. register queues per module
@Module({ imports: [QueueModule.registerQueue('emails')], providers: [EmailsProcessor] })
export class EmailsModule {}

// 3. produce
@Injectable()
export class EmailsService {
  constructor(@InjectQueue('emails') private emails: Queue) {}
  welcome(userId: string) {
    return this.emails.add('welcome', { userId }, { delay: 5000 });
  }
}

// 4. consume — subclass SdWorkerHost, throw on failure → BullMQ retries with backoff
@Processor('emails', { concurrency: 5 })
export class EmailsProcessor extends SdWorkerHost<{ userId: string }> {
  async handle(job: Job<{ userId: string }>) {
    await sendWelcome(job.data.userId);
  }
}
```

> Don't override `process()` or swallow errors — `SdWorkerHost` re-throws so BullMQ records the failed
> attempt and applies `attempts` + `backoff`. Use the queue for fan-out work; use
> [`JobScheduler.runExclusive`](#features) when N nodes fire the same scheduled task and only one should run it.

---

## Features

Three **stateful** modules ship from `@sdcorejs/nestjs/features`. Each is opt-in — wired only when its
key is present in `SdCoreModule.forRoot({...})` — and each exports an entity you register with TypeORM
(`autoLoadEntities: true` or explicit listing). The two HTTP controllers are **drop-in but NOT
auto-registered**: add them to one of _your_ modules' `controllers` array so they inherit that module's
route prefix.

### Uploaded files

```ts
SdCoreModule.forRoot({
  uploadedFile: {
    // Explicit S3 selects the AWS SDK default credential chain when accessId/accessKey are omitted.
    driver: 's3',
    bucket: process.env.S3_BUCKET,
    region: process.env.AWS_REGION,
    folder: 'core',
    maxFileSizeBytes: 8 * 1024 * 1024,
    allowedMimeTypes: ['image/png', 'application/pdf'],
    resolveScope: (ctx) => ({ tenantCode: ctx.tenant, userId: ctx.userId }),
    authorizationPolicy: ({ context }) => (context.roles?.includes('file-admin') ? 'tenant' : 'owner'),
    // Omission denies cross-uploader attachment reads.
    attachedReadPolicy: ({ context, attachment }) =>
      attachment.module === 'cms' &&
      attachment.entity === 'asset' &&
      context.permissions?.includes('cms.asset.view'),
    // Disabled by default. If enabled, every DNS answer and redirect is SSRF-checked.
    remoteClone: { enabled: true, allowedHosts: ['assets.example.com'], maxBytes: 8 * 1024 * 1024 },
    cleanupAfterDays: 7,
  },
});
```

The S3 driver lazy-loads AWS SDK v3. S3 mode requires a nonblank `bucket`. When `accessId` and
`accessKey` are both omitted, `S3Client` uses the standard AWS credential provider chain
(recommended for workload identity); if either is configured, both must be nonblank. Partial or
blank credentials fail module configuration instead of silently selecting local storage. Set
`region` or provide it through the SDK provider chain. AWS SDK v2 (`aws-sdk`) is no longer used.

Storage keys are immutable, generated server-side, and tenant-namespaced:
`<folder>/tenant/<base64url-tenant>/<uuid>/<sanitized-original-name>`. The original filename is metadata only;
same-name and concurrent uploads cannot overwrite one another. The default access policy is
owner-only, and every lookup/mutation includes tenant plus owner/policy predicates in the database
query. Missing and unauthorized resources both return 404.

`UploadedFileService` is globally provided — inject it anywhere:

```ts
const file = await uploads.upload(buffer, 'invoice.pdf', { module: 'crm', entity: 'order', entityId });
const { stream, fileName } = await uploads.download(file.id);
await uploads.setExtraData<{ ocr: string }>(file.id, { ocr: 'parsed text' });

// A consumer can only narrow the module-level limits for one call.
const document = await uploads.upload(buffer, 'proposal.pptx', undefined, undefined, {
  contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  allowedMimeTypes: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  maxFileSizeBytes: 8 * 1024 * 1024,
});

// Pass a caller-owned manager to claim files in the same transaction as the domain row.
await dataSource.transaction(async (manager) => {
  await saveDomainRow(manager);
  await uploads.markUsed([document.id], { module: 'cms', entity: 'asset', entityId }, manager);
});

// Requires attachedReadPolicy approval and exact active attachment metadata.
const attached = await uploads.downloadAttached(document.id, {
  module: 'cms',
  entity: 'asset',
  entityId,
});
```

- **`UploadedFile<TExtraData>`** — generic entity with an `extraData` jsonb bag; type it per call.
- **Service** — `upload<T>(buffer, fileName?, meta?, extraData?, { contentType?, allowedMimeTypes?,
  maxFileSizeBytes? })` returns the
  authorized row; `download(id)` returns `{ stream, fileName }`; `findById<T>(id)` and every mutation
  enforce the same policy. Per-call MIME and byte limits are intersected/clamped with module
  configuration and therefore cannot widen it. `cloneFromUrl` is disabled unless explicitly configured.
- **Transactional attachment ownership** — `markUsed(ids, meta, manager?)` uses the supplied TypeORM
  `EntityManager` without opening a nested transaction. When omitted, the service preserves the
  existing all-or-nothing behavior by opening exactly one transaction. `downloadAttached(id,
  attachment)` is denied when `attachedReadPolicy` is absent or does not return `true`; after approval,
  the lookup remains tenant-bound and requires an active, used row with exact `module`, `entity`, and
  UUID (including UUIDv7) `entityId` metadata. It intentionally does not require the current user to
  be the original uploader. Policy denial, metadata mismatch, and storage failure all return 404.
- **Drop-in `UploadedFileController`** — `POST /uploaded-file` (multipart field `file`; optional
  `module` / `entity` / `entityId` / `type` query params) and `GET /uploaded-file/:id/download`.
  Guarded by `AuthGuard`; needs `@nestjs/platform-express`. Mount it under your prefix:

  ```ts
  import { UploadedFileController } from '@sdcorejs/nestjs/features';

  @Module({ controllers: [UploadedFileController] }) // a module routed under `core`
  export class CoreModule {} // → POST /core/uploaded-file, GET /core/uploaded-file/:id/download
  ```

- **Pending-first consistency** — regular and temporary uploads persist an exact future-dated
  `uploadPendingAt` lease before writing bytes and activate it only after storage succeeds.
  `deletionPendingAt` is a separate CAS-owned storage-delete claim. Maintenance retains unresolved
  upload tombstones across soft deletion and producer-process death; settled deletion work is
  prioritized so tombstones cannot starve it. Storage/finalization failures leave durable retry
  state with a one-minute future backoff so poison rows cannot monopolize bounded sweeps.
- **Cleanup and temporary files** — the fixed `@Cron('0 3 * * *')` always retries pending deletions;
  with `cleanupAfterDays > 0` it also purges never-attached files (`isUsed = false`) older than N days.
  `uploadTemporary()` requires that positive cleanup setting and persists a tracking row before bytes.
  Import `ScheduleModule.forRoot()` in the host or run the explicitly unsafe maintenance methods from
  a separately authorized worker. With `jobScheduler` wired, each daily sweep uses its DB lock. Only
  after draining producers and verifying no late write can occur may an operator call
  `unsafeSystemRetireUploadTombstone(id)` to settle a permanently abandoned upload tombstone.
- **Batch and response safety** — ID/reference batches are capped at 100; references are capped at
  1024 characters. Unknown or extensionless names are rejected. Downloads derive `Content-Type`, use
  safe attachment disposition, and set `X-Content-Type-Options: nosniff`.
- **Limits** — the drop-in controller accepts one buffered file with bounded fields/parts and a 25 MiB
  absolute ceiling. The library service defaults to 10 MiB; module configuration and per-call options
  can only lower the effective limit relative to the 25 MiB ceiling. The MIME allowlist, extension
  agreement, and practical magic-byte checks still apply. DOCX, XLSX, and PPTX receive bounded ZIP
  structural inspection: at most 2,048 entries, 100 MiB total declared uncompressed data, 50 MiB per
  entry, and a 100:1 per-entry compression ratio. Encrypted, ZIP64/multi-disk, unsafe or duplicate
  paths, malformed directory offsets, and containers missing `[Content_Types].xml` or the expected
  main document part are rejected. This inspection is not malware scanning; use a separately reviewed
  scanning/quarantine pipeline where threat detection is required, and a separately reviewed streaming
  workflow for files larger than the ceiling.

### Action history

Records per-entity change history and reads it back. The acting user is resolved per request from
`ContextService` (default `ctx.userId`) or a consumer `resolveActor(ctx)`.

```ts
SdCoreModule.forRoot({
  actionHistory: {
    resolveActor: (ctx) => ({ userId: ctx.userId, username: (ctx.user as AppUser | undefined)?.email }),
    authorizeRead: ({ context, tenantCode, table, tableId }) => auditPolicy.canRead(context, { tenantCode, table, tableId }),
    // Required only when a scoped resource uses a tenant property other than `tenantCode`.
    resolveResourceTenant: ({ resourceScope }) =>
      typeof resourceScope.organizationCode === 'string' ? resourceScope.organizationCode : undefined,
    redactFields: ['customer.taxId', 'integration.webhookSecret'],
    maxPageSize: 50,
    retentionDays: 365,
  },
});
```

- **Resource identity and tenant attribution** — repository history records the stable,
  schema-qualified TypeORM `EntityMetadata.tablePath` and scope values selected from the persisted
  row. Scoped columns are selected explicitly even when TypeORM marks them `select: false`; missing
  persisted scope fails with `MissingHistoryResourceScopeError`. The default history tenant is
  `resourceScope.tenantCode`; configure `resolveResourceTenant` for another tenant property. A
  missing or conflicting mapping fails with `MissingActionHistoryResourceTenantError`.
- **`ActionHistoryService`** — writes require a trusted resource tenant. Reads use
  `all({ table, tableId, pageNumber, pageSize })`, always query by tenant + table path + resource ID,
  and require an explicit `authorizeRead` decision. Missing and denied resources both return 404.
- **Snapshots** — common password/token/secret/key fields plus configured names/paths are recursively
  redacted before storage. Fixed traversal ceilings are depth 32, 10,000 nodes, and 1 MiB of UTF-8
  material; oversized snapshots throw `ActionHistorySnapshotLimitError` before persistence.
  `retentionDays` documents policy; the library does not auto-delete rows.
- **Drop-in `ActionHistoryController`** — `GET /action-history/:table/:tableId`. Guarded by
  `AuthGuard`; resource authorization remains enforced in the service.

### Job scheduler — distributed cron lock

Across N scaled nodes firing the same scheduled job, `runExclusive` guarantees a single winner runs it.

```ts
import { JobSchedulerService, JobSchedulerType } from '@sdcorejs/nestjs/features';

@Cron('*/5 * * * *')
async syncOrders() {
  const { acquired } = await this.jobs.runExclusive(
    { code: 'sync-orders', runKey: thisTickIso, type: JobSchedulerType.SCHEDULE },
    (lease) => this.doSync({ idempotencyKey: lease.idempotencyKey }),
  );
  // every other node returns { acquired: false } and does nothing
}
```

- Atomic `INSERT ... ON CONFLICT DO NOTHING` claims the lock. On conflict it re-claims a `FAIL` run OR
  a `RUNNING` row whose lease has expired (default **15 min**, `leaseMs`) — `SUCCESS` stays locked
  (run-once for `INITIAL` jobs). The winner runs `fn` and records `SUCCESS` / `FAIL`; on error the run
  is marked `FAIL` and re-thrown.
- **Canonical identity** — `code` is trimmed and bounded; `SCHEDULE` requires a non-empty per-tick
  `runKey`, while `INITIAL` forbids one. A versioned SHA-256 digest of type/code/runKey is the unique
  lock key, avoiding delimiter collisions. Invalid identity throws `InvalidJobIdentityOptionsError`.
- **Heartbeat** — while `fn` runs, `runExclusive` uses the database clock to touch `modifiedAt`. The
  default interval is the lower of **60 s** and one third of `leaseMs`; invalid/non-finite timing and
  enabled heartbeats at or above half the lease are rejected before SQL. Disable with
  `heartbeatMs: 0` only for jobs guaranteed to finish in < `leaseMs`.
- **Fencing** — every acquire/reclaim rotates a UUID `ownerToken`. Heartbeat, completion, failure, and
  release update only `{ id, ownerToken, status: RUNNING }`; a stale worker affects zero rows and
  cannot finalize a lease reclaimed by another worker. Direct calls accept a `JobLease` object.
- **External effects** — database fencing cannot undo an email, payment, or remote write completed
  just before lease loss. Use `JobExecutionLease.idempotencyKey` in a unique transactional outbox or
  downstream `Idempotency-Key`; it remains stable when the same logical run is reclaimed. Never use
  the rotating `ownerToken` for business deduplication.

```ts
// Long-running import — extend lease + heartbeat interval accordingly.
await this.jobs.runExclusive({ code: 'nightly-import', runKey: dayIso, leaseMs: 2 * 60 * 60 * 1000, heartbeatMs: 30_000 }, () =>
  this.doImport(),
);
```

Enable with `jobScheduler: {}`.

---

## Security and migration

Read [SECURITY.md](https://github.com/sdcorejs/sdcorejs-nestjs/blob/main/SECURITY.md) for the
supported-version policy, private vulnerability reporting, security assumptions, unsafe escape
hatches, and deployment guidance. Upgrades to these fail-closed contracts require coordinated
database, object-store, gateway, cache, and worker changes; follow the
[1.1.0 security-hardening migration guide](https://github.com/sdcorejs/sdcorejs-nestjs/blob/main/docs/migration-1.1-security-hardening.md).

---

## Philosophy

- **Neutral core tenancy** — consumer entities choose scope property/column names via `@Scoped()`;
  stateful uploaded-file/action-history features use their documented `tenantCode` schema.
- **Strategies are DI tokens, not subclassing** — each concern defines an interface and token;
  security-sensitive scoped access fails closed when required context or policy is absent.
- **No prototype pollution** — no `String.isUuid()` / `Array.prototype.distinct()`; use the exported helpers.
- **TypeORM 0.3.x bound** — no ORM abstraction; the library leans into TypeORM directly.
- **Bilingual errors** — throw i18n codes, not sentences.
- **TDD, high coverage** — every behavior ships with a spec; release is blocked under the coverage threshold.
- **Dual ESM + CJS** — the `exports` field maps both formats per sub-path.

See [docs/migration-from-core-be.md](./docs/migration-from-core-be.md) for porting an existing `core-be` app.

---

## License

[MIT](./LICENSE) © 2026 Trần Thuận Nghĩa
