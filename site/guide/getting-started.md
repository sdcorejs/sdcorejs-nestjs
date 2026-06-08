# Getting started

`@sdcorejs/nestjs` is a neutral NestJS framework library — the cross-cutting concerns every
multi-tenant service re-implements (multi-tenancy, audit, permission, request context, cache, HTTP
client, JWT/Keycloak, Zod validation, BullMQ queue, i18n), with **every domain specific injected via
DI strategies**. The library ships zero hardcoded column names.

## Install

```bash
npm install @sdcorejs/nestjs @sdcorejs/utils
```

### Peer dependencies

Already present in most NestJS 11 projects:

- `@nestjs/common` `^11` · `@nestjs/core` `^11` · `@nestjs/passport` `^11`
- `@nestjs/typeorm` `^11` · `typeorm` `^0.3.20`
- `reflect-metadata` `^0.2` · `rxjs` `^7.8`
- `@sdcorejs/utils` `^1.1` — shared `Filter` / `PagingReq` / `Order` models + `ValidationUtilities`

Always required (`SdCoreModule` statically wires the queue, scheduler, and upload controller):

- `bullmq` `^5` + `@nestjs/bullmq` `^11` — `QueueModule` is statically imported
- `@nestjs/schedule` `^4 || ^5 || ^6` — the uploaded-file cleanup `@Cron`
- `@nestjs/platform-express` `^11` — `FileInterceptor` for the `UploadedFileController`

Optional — install only when you use the feature:

| Package | Enables |
|---|---|
| `ioredis` `^5` | redis cache backend (`@sdcorejs/nestjs/services`) |
| `zod` `^4` | request validation (`@sdcorejs/nestjs/validation`) — **v4 only** |
| `jwks-rsa` `^3` + `jsonwebtoken` `^9` | Keycloak / OIDC JWKS verification (`@sdcorejs/nestjs/auth`) |
| `passport` + `passport-jwt` | JWT auth strategies |

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
