# Getting started

`@sdcorejs/nestjs` is a neutral NestJS framework library — the cross-cutting concerns every
multi-tenant service re-implements (multi-tenancy, audit, permission, request context, cache, HTTP
client, JWT/Keycloak, Zod validation, BullMQ queue, i18n), with **every domain specific injected via
DI strategies**. The library ships zero hardcoded column names.

## Install

```bash
npm install @sdcorejs/nestjs
```

Engines: `node >=18.18`.

### Peer dependencies — just two

| Package | Version | Why peer? |
|---|---|---|
| `@nestjs/common` | `^11.0.0` | Shared DI container — must match your app's NestJS instance |
| `@nestjs/core` | `^11.0.0` | Same — one NestJS runtime per app |

Every NestJS 11 app already has these. They stay peers (not bundled) so the library injects into your
app's container, not a duplicate one.

### Bundled (`dependencies`)

Installed automatically — you never add these to your own `package.json`:

| Package | Version | Purpose |
|---|---|---|
| `@nestjs/passport` | `^11` | Passport DI integration |
| `@nestjs/typeorm` | `^11` | TypeORM module |
| `@nestjs/bullmq` | `^11` | BullMQ queue module |
| `@nestjs/schedule` | `^6` | `@Cron` for orphan-file cleanup |
| `@nestjs/platform-express` | `^11` | `FileInterceptor` |
| `typeorm` | `^0.3` | ORM core |
| `reflect-metadata` | `^0.2` | Decorator metadata (singleton — npm hoists) |
| `rxjs` | `^7.8` | Observables |
| `@sdcorejs/utils` | `^1.1` | Shared `Filter` / `PagingReq` / `Order` models |
| `axios` | `^1.7` | Context-aware HTTP client |
| `bullmq` | `^5` | BullMQ core |
| `passport` | `^0.7` | Passport |
| `passport-jwt` | `^4` | JWT Passport strategy |

::: tip typeorm singleton
npm hoists a single `typeorm` and `reflect-metadata` copy when your app's version ranges overlap with
`^0.3` / `^0.2` (true for all NestJS 11 projects). No duplicated ORM instances.
:::

### Optional (`optionalDependencies`)

Auto-installed, but a failed install won't block yours. Skip with `--no-optional` if unused:

| Package | Version | Enables |
|---|---|---|
| `ioredis` | `^5` | Redis cache backend (`@sdcorejs/nestjs/services`) |
| `zod` | `^4` ⚠️ **v4 only** | Request validation (`@sdcorejs/nestjs/validation`) — v3 not supported |
| `jwks-rsa` | `^4` | Per-token JWKS key fetch for Keycloak / OIDC (`@sdcorejs/nestjs/auth`) |
| `jsonwebtoken` | `^9` | JWT decode + verify, used by `KeycloakJwtStrategy` |
| `aws-sdk` | `^2` | S3 storage driver for uploaded files (`@sdcorejs/nestjs/features`) |

## Quick start

`SdCoreModule.forRoot({...})` is the **single import** that composes every sub-module.
Always-on: context, tenancy, audit, permission, cache, HTTP client.
Opt-in (wired only when the config key is present): `jwt`, `i18n`, `uploadedFile`, `actionHistory`,
`jobScheduler`, `queue`.

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

::: tip tenancy: strategy vs. callbacks
Pass `{ strategy: MyTenancyStrategy }` for a full DI-injected class, or use inline `{ resolve, bypass }`
callbacks for simple cases that need no extra injected services.
:::

::: tip internal secret
`internalSecret: { envVar: 'INTERNAL_SECRET_KEY' }` wires the built-in `EnvInternalSecretProvider`.
To rotate secrets, implement `IInternalSecretProvider` yourself and register it via
`providers: [{ provide: INTERNAL_SECRET_PROVIDER, useClass: ... }]`.
:::

::: tip feature entities
`UploadedFile`, `ActionHistory`, `JobScheduler` export from `@sdcorejs/nestjs/features`. Register them
with TypeORM via `autoLoadEntities: true` or by listing them explicitly.
:::

Next: wire [multi-tenancy](/guide/multi-tenancy), [permissions](/guide/permissions), and
[JWT/Keycloak auth](/guide/jwt-keycloak).
