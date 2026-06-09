# @sdcorejs/nestjs

> Neutral NestJS framework library — base classes plus the cross-cutting concerns every multi-tenant service re-implements (multi-tenancy, audit, permission, request context, cache, HTTP client, JWT/Keycloak, Zod validation, BullMQ queue). **Every domain specific is injected via DI strategies** — the library ships zero hardcoded column names. Extracted from `be-masterdata/core-be/` and refactored to be reusable across any NestJS 11 + TypeORM 0.3.x project.

**Status**: `1.0.0` — stable. Public API follows [Semantic Versioning](https://semver.org/).

📖 **Showcase & guides**: [sdcorejs.github.io/sdcorejs-nestjs](https://sdcorejs.github.io/sdcorejs-nestjs/)

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
- [Background jobs (BullMQ)](#background-jobs-bullmq)
- [Features](#features)
- [Philosophy](#philosophy)
- [License](#license)

---

## Installation

```bash
npm install @sdcorejs/nestjs
```

**Peer dependencies — just two** (every NestJS app already has them):

- `@nestjs/common` `^11` · `@nestjs/core` `^11`

Everything else installs automatically with the package, on any package manager.

**Bundled** (`dependencies` — you never install these): `@nestjs/passport`, `@nestjs/typeorm`,
`@nestjs/bullmq` (queue), `@nestjs/schedule` (cleanup `@Cron`), `@nestjs/platform-express`
(`FileInterceptor`), `typeorm`, `reflect-metadata`, `rxjs`, `@sdcorejs/utils` (shared `Filter` /
`PagingReq` / `Order` models + `ValidationUtilities`), `axios`, `bullmq`, `passport`, `passport-jwt`.

**Optional** (`optionalDependencies` — auto-installed, but a failed install won't break yours; skip with
`--no-optional` if you don't use the feature):

| Package | Enables |
|---|---|
| `ioredis` `^5` | redis cache backend (`@sdcorejs/nestjs/services`) |
| `zod` `^4` | request validation (`@sdcorejs/nestjs/validation`) — **v4 only** |
| `jwks-rsa` `^3` + `jsonwebtoken` `^9` | Keycloak / OIDC JWKS verification (`@sdcorejs/nestjs/auth`) |
| `aws-sdk` `^2` | S3 driver for uploaded files (`@sdcorejs/nestjs/features`) |

> Only `@nestjs/common` / `@nestjs/core` stay peers so they reuse your app's instances (DI container).
> `typeorm` / `reflect-metadata` are bundled too — npm hoists a single copy when your app's versions
> are compatible (the whole NestJS 11 ecosystem is on `typeorm@^0.3` / `reflect-metadata@^0.2`).

Engines: `node >=18.18`.

---

## Sub-paths

The package has multiple entry points; import only what you use.

| Import | What's inside |
|---|---|
| `@sdcorejs/nestjs` | `SdCoreModule.forRoot({...})` + ergonomic re-exports of all public symbols |
| `@sdcorejs/nestjs/core` | ORM base classes (`BaseEntity`, `WithTimestamps`, `WithAudit`, `BaseRepository`, `BaseService`, `BaseController`, `@Scoped`, `@SearchableFields`, `@Schema`, `apiError`/`ApiResponse`), request context (`ContextService`, `ContextMiddleware`, `RequestContext`), multi-tenancy (`ITenancyStrategy`, `TENANCY_STRATEGY`, `buildScopeFilters`/`buildScopeWhere`), and audit (`IAuditStrategy`, `AUDIT_STRATEGY`, `AuditSubscriber`) |
| `@sdcorejs/nestjs/auth` | JWT / Keycloak strategies (`JwtModule`, `JwtStrategy`, `KeycloakJwtStrategy`, `JWT_CONFIG`), plus permission enforcement (`IPermissionStrategy`, `AuthGuard`, `InternalGuard`, `@HasPermission`, `@HasAnyPermission`, `IInternalSecretProvider`, `IInternalContextEnricher`) |
| `@sdcorejs/nestjs/services` | HTTP client (`HttpService`, axios-based, context-aware) + cache (`CacheService`, `CacheInterceptor`, `@Cached` — memory and redis backends) |
| `@sdcorejs/nestjs/queue` | `QueueModule`, `SdWorkerHost` (BullMQ + Redis) + re-exported `Processor`/`InjectQueue`/`Job`/`Queue` |
| `@sdcorejs/nestjs/validation` | `ZodValidationGuard(schema \| map, source)`, `parseZod`, query presets (`zPaging`, `zUuid`, `zBool`), `ZodIssueDetail` (Zod **v4**) |
| `@sdcorejs/nestjs/i18n` | `II18nResolver`, `ILanguageResolver`, `SimpleI18nResolver`, `DefaultLanguageResolver`, `SdI18nExceptionFilter`, built-in en/vi `core.*` catalogs, `I18nModule` |
| `@sdcorejs/nestjs/features` | Stateful feature modules — `ActionHistory`, `JobScheduler`, `UploadedFile` (entity + service + module each), plus drop-in `UploadedFileController` / `ActionHistoryController` |

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

@Module({
  imports: [
    SdCoreModule.forRoot({
      context: { headers: { tenant: 'x-tenant', userId: 'x-user-id' } },
      cache: {},
      i18n: {
        fallbackLanguage: 'vi',
        supportedLanguages: ['vi', 'en'],
        catalogs: MY_CATALOGS,
      },
      permission: { strategy: MyPermissionStrategy },
      // Built-in secret provider — reads process.env[envVar] at request time.
      // Alternative: pass { key: 'literal-secret' } or omit and provide INTERNAL_SECRET_PROVIDER yourself.
      internalSecret: { envVar: 'INTERNAL_SECRET_KEY' },
      // tenancy accepts EITHER a strategy class OR inline { resolve, bypass } callbacks:
      tenancy: {
        bypass: (rc) => rc.custom?.isMaster === true,
        resolve: (rc) => ({
          tenantCode: rc.tenant,
          departmentCode: rc.custom?.departmentCode,
        }),
      },
      // Opt-in features — omit any key to disable:
      jwt: { jwks: { allowedIssuers: [process.env.KEYCLOAK_ISSUER!] } },
      uploadedFile: { bucket: process.env.S3_BUCKET /* ... */ },
      actionHistory: { resolveActor: () => ({ /* ... */ }) },
      jobScheduler: {},
      queue: { connection: { host: 'localhost', port: 6379 } },
    }),
    // Register lib entities via autoLoadEntities (UploadedFile, ActionHistory, JobScheduler):
    TypeOrmModule.forRoot({ autoLoadEntities: true /* ... */ }),
    // your domain modules...
  ],
})
export class AppModule {}
```

> **`tenancy` strategy vs. callbacks** — pass `{ strategy: MyTenancyStrategy }` to supply a full DI-injected class, or use inline `{ resolve, bypass }` callbacks for simple cases that need no extra injected services.

> **Internal secret** — `internalSecret: { envVar: 'INTERNAL_SECRET_KEY' }` wires the built-in `EnvInternalSecretProvider`. To rotate secrets, implement `IInternalSecretProvider` yourself and register it via `providers: [{ provide: INTERNAL_SECRET_PROVIDER, useClass: ... }]`.

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
  @Column({ nullable: true }) @Scoped() departmentCode?: string;
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

- **Reads** (`paging`, `all`, `search`, `detail`) — injects a scope filter per `@Scoped` column. A **scalar** scope value becomes `EQUAL`; an **array** becomes `IN` (multi-department users); `null` / `undefined` / empty array is skipped.
- **Writes** (`create`, `import`) — auto-fills the scoped columns from `getCurrentScope()`.
- **`detail(id)`** is scoped too — fetching a known UUID that belongs to another tenant returns `null` (no cross-tenant id leak).
- **`shouldBypass(ctx) === true`** skips both filter injection and auto-fill.

> With no strategy registered, the repository behaves as if tenancy is disabled — no overhead.

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
import { Injectable } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import { ContextService } from '@sdcorejs/nestjs/core';
import type { IInternalContextEnricher } from '@sdcorejs/nestjs/auth';

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
import { InternalGuard } from '@sdcorejs/nestjs/auth';

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
declare module '@sdcorejs/nestjs/core' {
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
import { BaseRepository } from '@sdcorejs/nestjs/core';

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
| POST | `/paging` | `paging(req)` — `pageSize` capped at **200** |
| GET | `/:id` | `detail(id)` (tenancy-scoped) |
| DELETE | `/:id` | `delete(id)` |

`all()` (unbounded full-table read), `pagingDeleted`, soft-delete and restore live on `BaseService`/`BaseRepository` but are **not** exposed by the controller — add an `@Get('all')` in your subclass for the specific entities where a full read is appropriate. `@SearchableFields({ exact, contain, activeColumn })` configures the `search` endpoint; `@Schema` adds DTO introspection metadata.

---

## Validation (Zod v4)

> Requires `zod@^4`. Zod v3 is not supported (issue shape differs).

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
  welcome(userId: string) { return this.emails.add('welcome', { userId }, { delay: 5000 }); }
}

// 4. consume — subclass SdWorkerHost, throw on failure → BullMQ retries with backoff
@Processor('emails', { concurrency: 5 })
export class EmailsProcessor extends SdWorkerHost<{ userId: string }> {
  async handle(job: Job<{ userId: string }>) { await sendWelcome(job.data.userId); }
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
auto-registered**: add them to one of *your* modules' `controllers` array so they inherit that module's
route prefix.

### Uploaded files

```ts
SdCoreModule.forRoot({
  uploadedFile: {
    // driver auto-detected: 's3' when creds present, else 'local'
    bucket: process.env.S3_BUCKET,
    accessId: process.env.S3_ACCESS_ID,
    accessKey: process.env.S3_ACCESS_KEY,
    cdnBaseUrl: process.env.S3_CDN,        // builds the returned `cdn` field
    folder: 'core',                        // permanent-file prefix (default 'core')
    cleanupAfterDays: 7,                   // opt-in 03:00 cron purge of never-attached files
  },
});
```

`UploadedFileService` is globally provided — inject it anywhere:

```ts
const file = await uploads.upload(buffer, 'invoice.pdf', { module: 'crm', entity: 'order', entityId });
const { stream, fileName } = await uploads.download(file.id);
await uploads.setExtraData<{ ocr: string }>(file.id, { ocr: 'parsed text' });
```

- **`UploadedFile<TExtraData>`** — generic entity with an `extraData` jsonb bag; type it per call.
- **Service** — `upload<T>(buffer, fileName?, meta?, extraData?)` → full row; `download(id)` →
  `{ stream, fileName }`; `findById<T>(id)`; `setExtraData<T>(id, data)`; plus `useFiles` /
  `markUsed` / `delete`.
- **Drop-in `UploadedFileController`** — `POST /uploaded-file` (multipart field `file`; optional
  `module` / `entity` / `entityId` / `type` query params) and `GET /uploaded-file/:id/download`.
  Guarded by `AuthGuard`; needs `@nestjs/platform-express`. Mount it under your prefix:

  ```ts
  import { UploadedFileController } from '@sdcorejs/nestjs/features';

  @Module({ controllers: [UploadedFileController] }) // a module routed under `core`
  export class CoreModule {}                          // → POST /core/uploaded-file, GET /core/uploaded-file/:id/download
  ```

- **`cleanupAfterDays`** — when set (`> 0`), a fixed `@Cron('0 3 * * *')` purges never-attached files
  (`isUsed = false`) older than N days. Requires `ScheduleModule.forRoot()` in the host. When the
  `jobScheduler` feature is also wired, each sweep takes the distributed DB lock so only one instance
  purges; otherwise it runs directly. Omit (or `<= 0`) to disable — nothing is deleted.

### Action history

Records per-entity change history and reads it back. The acting user is resolved per request from
`ContextService` (default `ctx.userId`) or a consumer `resolveActor(ctx)`.

```ts
SdCoreModule.forRoot({
  actionHistory: { resolveActor: (ctx) => ({ userId: ctx.userId, username: ctx.user?.email }) },
});
```

- **`ActionHistoryService`** — `record(entry)` (called automatically by `BaseRepository` CUD when
  `logHistory` is enabled) and `all(tableId)` → newest-first DTO list.
- **Drop-in `ActionHistoryController`** — `GET /action-history/:tableId`. Guarded by `AuthGuard`;
  mount it under your prefix the same way as `UploadedFileController` (→ `GET /core/action-history/:tableId`).

### Job scheduler — distributed cron lock

Across N scaled nodes firing the same scheduled job, `runExclusive` guarantees a single winner runs it.

```ts
import { JobSchedulerService, JobSchedulerType } from '@sdcorejs/nestjs/features';

@Cron('*/5 * * * *')
async syncOrders() {
  const { acquired } = await this.jobs.runExclusive(
    { code: 'sync-orders', runKey: thisTickIso, type: JobSchedulerType.SCHEDULE },
    () => this.doSync(),
  );
  // every other node returns { acquired: false } and does nothing
}
```

- Atomic `INSERT ... ON CONFLICT DO NOTHING` claims the lock. On conflict it re-claims **only a
  previously `FAIL` run** — a `SUCCESS` run stays locked (run-once for `INITIAL` jobs) and a `RUNNING`
  row is left to its owner. The winner runs `fn` and records `SUCCESS` / `FAIL`; on error the run is
  marked `FAIL` and the error re-thrown.

Enable with `jobScheduler: {}`.

---

## Philosophy

- **Fully neutral** — no `tenantCode`/`departmentCode` hardcoded; consumer chooses column names via `@Scoped()` and writes its own strategies.
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
