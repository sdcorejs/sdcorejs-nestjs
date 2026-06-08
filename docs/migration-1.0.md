# Migrating to @sdcorejs/nestjs 1.0.0

1.0.0 finalizes the public API. Breaking changes from 0.1.x:

| Removed | Use instead |
|---|---|
| `SdFilter` / `SdFilterOperator` / `SdOrder` / `SdPagingReq` / `SdPagingRes` (`/orm`) | `Filter` / `Operator` / `Order` / `PagingReq` / `PagingRes` from `@sdcorejs/utils/models` |
| `Scoped` / `TenantScoped` / `getScopedColumns` from `/tenancy` | `Scoped` / `getScopedColumns` from `@sdcorejs/nestjs/core` — the `TenantScoped` alias is **removed**; use `@Scoped()` |
| `ValidationUtilities` / `ArrayUtilities` / `StringUtilities` / `Utilities` from `/orm` | `@sdcorejs/utils/fns` |
| `slugify` / `isBlank` / `toMb` / `addDays` / `distinct` from `/file-storage` | internal helpers; use `@sdcorejs/utils` (`ArrayUtilities.distinct`) |
| internal metadata keys + accessors leaked from `/orm`, `/context`, `/cache`, `/validation`, `/i18n` | not public — see `docs/superpowers/specs/2026-06-07-1.0.0-api-audit-findings.md` |
| `propertyOf` (was internal `src/utils`) | `NestedKeyOf<T>` from `@sdcorejs/utils/models` |

## Module resolution

Types are now resolved through the package `exports` map's per-format conditions
(`.d.mts` for ESM, `.d.ts` for CJS). Do not deep-import into `dist/`. Always import
from the documented sub-paths, e.g. `@sdcorejs/nestjs/orm`.

## Directory reorg (1.0.0)

| Change | Action |
|---|---|
| `@sdcorejs/nestjs/file-storage` → `/uploaded-file` | update import paths |
| `FileEntity` → `UploadedFile` | update imports |
| `FileStorageModule` → `UploadedFileModule` | update bootstrap |
| `FileStorageConfig`/`IFileStorageService`/`AwsFileStorageService`/`LocalFileStorageService`/`FILE_STORAGE_CONFIG`/`FileUploadMeta`/`UploadResult` | renamed to `UploadedFile*` / `IUploadedFileStorage` / `UPLOADED_FILE_CONFIG` |
| `@sdcorejs/nestjs/{file-storage,action-history,job-scheduler,uploaded-file}` and the interim `/entities` | all consolidated into a single `@sdcorejs/nestjs/features` |
| `@sdcorejs/nestjs/{orm,context,tenancy,audit}` | consolidated into `@sdcorejs/nestjs/core` |
| `@sdcorejs/nestjs/{jwt,permission}` | consolidated into `@sdcorejs/nestjs/auth` |
| `@sdcorejs/nestjs/{http,cache}` | consolidated into `@sdcorejs/nestjs/services` |
| **DB:** table `file` → `uploaded_file` | add a rename migration: `ALTER TABLE "file" RENAME TO "uploaded_file";` |

## Dependencies & peers

**Peer dependencies are now just two:** `@nestjs/common` `^11` and `@nestjs/core` `^11` — every NestJS
app already has them. They stay peers so the library reuses your app's DI container (one instance).
`npm install @sdcorejs/nestjs` is all a consumer runs; everything else installs with it, on any package
manager.

Moved from peer → **bundled `dependencies`** (auto-installed): `@nestjs/passport`, `@nestjs/typeorm`,
`@nestjs/bullmq`, `@nestjs/schedule`, `@nestjs/platform-express`, `typeorm`, `reflect-metadata`, `rxjs`
(joining the already-bundled `@sdcorejs/utils`, `axios`, `bullmq`, `passport`, `passport-jwt`).

Moved from optional peer → **`optionalDependencies`** (auto-installed, non-fatal; `--no-optional` to
skip): `ioredis`, `zod`, `jwks-rsa`, `jsonwebtoken`, `aws-sdk`.

> `typeorm` / `reflect-metadata` are singletons but bundled: npm hoists a single copy when your app's
> versions are compatible (the NestJS 11 ecosystem is uniformly on `typeorm@^0.3` / `reflect-metadata@^0.2`).
> If you ever pin a divergent major, list them in your app to force one copy.

## Single-module wiring

Previously, consumers composed 9+ separate module imports in `AppModule`:

```ts
// 0.x — multiple hand-wired imports
imports: [
  ContextModule.forRoot({ headers: { ... } }),
  TenancyModule.forRoot({ strategy: AppTenancyStrategy }),
  AuditModule.forRoot({ strategy: AppAuditStrategy }),
  PermissionModule.forRoot({ strategy: AppPermissionStrategy }),
  CacheModule.forRoot({ ttl: 60 }),
  HttpClientModule.forRoot({ baseURL: process.env.UPSTREAM_API }),
  JwtModule.forRoot({ jwks: { allowedIssuers: [...] } }),
  I18nModule.forRoot({ fallbackLanguage: 'vi' }),
  QueueModule.forRoot({ connection: { ... } }),
  // + custom providers for INTERNAL_SECRET_PROVIDER, etc.
]
```

In 1.0.0, one call replaces all of them:

```ts
// 1.0.0 — single unified module
import { SdCoreModule } from '@sdcorejs/nestjs';

imports: [
  SdCoreModule.forRoot({
    context: { headers: { tenant: 'x-tenant', userId: 'x-user-id' } },
    cache: {},
    permission: { strategy: MyPermissionStrategy },
    // Built-in EnvInternalSecretProvider — no custom class needed for the common case:
    internalSecret: { envVar: 'INTERNAL_SECRET_KEY' },
    // Inline tenancy callbacks replace a separate ITenancyStrategy class for simple cases:
    tenancy: {
      bypass: (rc) => rc.custom?.isMaster === true,
      resolve: (rc) => ({ tenantCode: rc.tenant, departmentCode: rc.custom?.departmentCode }),
    },
    // Opt-in: omit any key to skip that sub-module entirely
    jwt: { jwks: { allowedIssuers: [process.env.KEYCLOAK_ISSUER!] } },
    i18n: { fallbackLanguage: 'vi', supportedLanguages: ['vi', 'en'], catalogs: MY_CATALOGS },
    uploadedFile: { bucket: process.env.S3_BUCKET },
    actionHistory: { resolveActor: () => ({ /* ... */ }) },
    jobScheduler: {},
    queue: { connection: { host: 'localhost', port: 6379 } },
  }),
  TypeOrmModule.forRoot({ autoLoadEntities: true }),
]
```

Key migration notes:
- `tenancy` accepts EITHER `{ strategy: MyTenancyStrategy }` (full DI class, unchanged) OR the new inline `{ resolve, bypass }` callbacks.
- `internalSecret: { envVar: 'VAR_NAME' }` replaces a custom `IInternalSecretProvider` implementation in the common single-secret case. To support key rotation, still implement `IInternalSecretProvider` with `getKeys()`.
- Feature keys (`uploadedFile`, `actionHistory`, `jobScheduler`) are fully opt-in; omitting them adds zero overhead.
