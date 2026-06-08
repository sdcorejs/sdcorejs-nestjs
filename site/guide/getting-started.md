# Getting started

`@sdcorejs/nestjs` is a neutral NestJS framework library — the cross-cutting concerns every
multi-tenant service re-implements (multi-tenancy, audit, permission, request context, cache, HTTP
client, JWT/Keycloak, Zod validation, BullMQ queue, i18n), with **every domain specific injected via
DI strategies**. The library ships zero hardcoded column names.

## Install

```bash
npm install @sdcorejs/nestjs
```

### Bundled automatically

Shipped as regular `dependencies` — you never install them: `@sdcorejs/utils` (shared `Filter` /
`PagingReq` / `Order` models + `ValidationUtilities`), `bullmq`, `axios`, `passport`, `passport-jwt`.

### Required peers

The framework singletons that must be **one shared copy** with your app (NestJS DI container, TypeORM
metadata, the `reflect-metadata` registry). These stay peers so a second copy is never shipped —
bundling them would break DI and decorator metadata.

::: tip npm 7+ installs these for you
`npm install @sdcorejs/nestjs` pulls every required peer automatically. **pnpm / yarn-classic** don't —
add them to your app, or set `auto-install-peers=true`.
:::

- `@nestjs/common` `^11` · `@nestjs/core` `^11` · `@nestjs/passport` `^11` · `@nestjs/typeorm` `^11`
- `typeorm` `^0.3.20` · `reflect-metadata` `^0.2` · `rxjs` `^7.8`
- `@nestjs/bullmq` `^11` — `QueueModule` is statically imported by `SdCoreModule`
- `@nestjs/schedule` `^4 || ^5 || ^6` — the uploaded-file cleanup `@Cron`
- `@nestjs/platform-express` `^11` — `FileInterceptor` for the `UploadedFileController`

### Optional peers

Not auto-installed — add only when you use the feature:

| Package | Enables |
|---|---|
| `ioredis` `^5` | redis cache backend (`@sdcorejs/nestjs/services`) |
| `zod` `^4` | request validation (`@sdcorejs/nestjs/validation`) — **v4 only** |
| `jwks-rsa` `^3` + `jsonwebtoken` `^9` | Keycloak / OIDC JWKS verification (`@sdcorejs/nestjs/auth`) |
| `aws-sdk` `^2` | S3 driver for uploaded files (`@sdcorejs/nestjs/features`) |

Engines: `node >=18.18`.

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
