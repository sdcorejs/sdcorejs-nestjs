# Migrating to @sdcorejs/nestjs 1.0.0

> This historical 1.0 migration guide predates the fail-closed security contracts. Its configuration
> examples have been updated to use verified principals and structured bypass grants, but you must
> still complete [the 1.1.0 security-hardening migration](./migration-1.1-security-hardening.md).

1.0.0 finalizes the public API. Breaking changes from 0.1.x:

| Removed                                                                                             | Use instead                                                                                                           |
| --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `SdFilter` / `SdFilterOperator` / `SdOrder` / `SdPagingReq` / `SdPagingRes` (`/orm`)                | `Filter` / `Operator` / `Order` / `PagingReq` / `PagingRes` from `@sdcorejs/utils/models`                             |
| `Scoped` / `TenantScoped` / `getScopedColumns` from `/tenancy`                                      | `Scoped` / `getScopedColumns` from `@sdcorejs/nestjs/core` — the `TenantScoped` alias is **removed**; use `@Scoped()` |
| `ValidationUtilities` / `ArrayUtilities` / `StringUtilities` / `Utilities` from `/orm`              | `@sdcorejs/utils/fns`                                                                                                 |
| `slugify` / `isBlank` / `toMb` / `addDays` / `distinct` from `/file-storage`                        | internal helpers; use `@sdcorejs/utils` (`ArrayUtilities.distinct`)                                                   |
| internal metadata keys + accessors leaked from `/orm`, `/context`, `/cache`, `/validation`, `/i18n` | not public; migrate to the documented decorators, modules, and eight supported entry points                              |
| `propertyOf` (was internal `src/utils`)                                                             | `NestedKeyOf<T>` from `@sdcorejs/utils/models`                                                                        |

## Module resolution

Types are now resolved through the package `exports` map's per-format conditions
(`.d.mts` for ESM, `.d.ts` for CJS). Do not deep-import into `dist/`. Always import
from the documented sub-paths, e.g. `@sdcorejs/nestjs/core`.

## Directory reorg (1.0.0)

| Change                                                                                                                                            | Action                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `@sdcorejs/nestjs/file-storage` → `/uploaded-file`                                                                                                | update import paths                                                          |
| `FileEntity` → `UploadedFile`                                                                                                                     | update imports                                                               |
| `FileStorageModule` → `UploadedFileModule`                                                                                                        | update bootstrap                                                             |
| `FileStorageConfig`/`IFileStorageService`/`AwsFileStorageService`/`LocalFileStorageService`/`FILE_STORAGE_CONFIG`/`FileUploadMeta`/`UploadResult` | renamed to `UploadedFile*` / `IUploadedFileStorage` / `UPLOADED_FILE_CONFIG` |
| `@sdcorejs/nestjs/{file-storage,action-history,job-scheduler,uploaded-file}` and the interim `/entities`                                          | all consolidated into a single `@sdcorejs/nestjs/features`                   |
| `@sdcorejs/nestjs/{orm,context,tenancy,audit}`                                                                                                    | consolidated into `@sdcorejs/nestjs/core`                                    |
| `@sdcorejs/nestjs/{jwt,permission}`                                                                                                               | consolidated into `@sdcorejs/nestjs/auth`                                    |
| `@sdcorejs/nestjs/{http,cache}`                                                                                                                   | consolidated into `@sdcorejs/nestjs/services`                                |
| **DB:** table `file` → `uploaded_file`                                                                                                            | add a rename migration: `ALTER TABLE "file" RENAME TO "uploaded_file";`      |

## Dependencies & peers

**Peer dependencies are now just two:** `@nestjs/common` `^11` and `@nestjs/core` `^11` — every NestJS
app already has them. They stay peers so the library reuses your app's DI container (one instance).
`npm install @sdcorejs/nestjs` is all a consumer runs; everything else installs with it, on any package
manager.

Moved from peer → **bundled `dependencies`** (auto-installed): `@nestjs/passport`, `@nestjs/typeorm`,
`@nestjs/bullmq`, `@nestjs/schedule`, `@nestjs/platform-express`, `typeorm`, `reflect-metadata`, `rxjs`
(joining the already-bundled `@sdcorejs/utils`, `axios`, `bullmq`, `passport`, `passport-jwt`).

Moved from optional peer → **`optionalDependencies`** (auto-installed, non-fatal; `--omit=optional` to
skip): `ioredis`, `jwks-rsa`, `jsonwebtoken`, `@aws-sdk/client-s3`. In 1.1.0, `zod` moved to regular
dependencies because the root entry point exports validation APIs and therefore loads the Zod chunk.

Version 1.1.0 security hardening replaces end-of-support AWS SDK v2 (`aws-sdk`) with the modular AWS SDK
v3 package `@aws-sdk/client-s3@^3.1090`. Remove `aws-sdk` when the application does not use it
directly. The uploaded-file driver now uses the AWS default credential provider chain when
`accessId`/`accessKey` are both omitted; explicit credentials still require both values.

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
import { z } from 'zod';

const AppClaimsSchema = z.object({
  sub: z.string().min(1),
  tenant_code: z.string().min(1),
  roles: z.array(z.string().min(1)).optional(),
  permissions: z.array(z.string().min(1)).optional(),
  department_code: z.string().min(1).optional(),
});

imports: [
  SdCoreModule.forRoot({
    context: {
      identity: {
        // Passport has already verified this principal; raw identity headers are ignored.
        principalResolver: (principal: unknown) => {
          const claims = AppClaimsSchema.parse(principal);
          return {
            userId: claims.sub,
            tenant: claims.tenant_code,
            roles: claims.roles ?? [],
            permissions: claims.permissions ?? [],
            custom: { departmentCode: claims.department_code },
          };
        },
      },
    },
    cache: {},
    permission: { strategy: MyPermissionStrategy },
    // Built-in EnvInternalSecretProvider — no custom class needed for the common case:
    internalSecret: { envVar: 'INTERNAL_SECRET_KEY' },
    // Inline tenancy callbacks replace a separate ITenancyStrategy class for simple cases.
    tenancy: {
      resolve: (rc) => ({ tenantCode: rc.tenant, departmentCode: rc.custom?.departmentCode }),
      bypassGrant: (rc) => {
        if (!rc.userId || !rc.roles?.includes('platform-admin')) return undefined;
        return {
          authorized: true,
          actorId: rc.userId,
          reason: 'approved cross-tenant maintenance',
          allowedTargets: [dataSource.getMetadata(Product).tablePath],
          allowedOperations: ['read'],
          audit: (event) => privilegedAuditSink.writeSync(event),
        };
      },
    },
    // Opt-in: omit any key to skip that sub-module entirely
    jwt: { jwks: { allowedIssuers: [process.env.KEYCLOAK_ISSUER!] } },
    i18n: { fallbackLanguage: 'vi', supportedLanguages: ['vi', 'en'], catalogs: MY_CATALOGS },
    uploadedFile: { driver: 's3', bucket: process.env.S3_BUCKET, region: process.env.AWS_REGION },
    actionHistory: {
      resolveActor: () => ({
        /* ... */
      }),
    },
    jobScheduler: {},
    queue: { connection: { host: 'localhost', port: 6379 } },
  }),
  TypeOrmModule.forRoot({ autoLoadEntities: true }),
];
```

Key migration notes:

- `tenancy` accepts either `{ strategy: MyTenancyStrategy }` (full DI class, unchanged) or inline
  `{ resolve, bypassGrant }` callbacks. A grant must restrict stable `EntityMetadata.tablePath`
  targets and operations and include an actor, reason, and synchronous audit sink. Legacy boolean
  `bypass`/`shouldBypass` callbacks cannot authorize access.
- `internalSecret: { envVar: 'VAR_NAME' }` replaces a custom `IInternalSecretProvider` implementation in the common single-secret case. To support key rotation, still implement `IInternalSecretProvider` with `getKeys()`.
- Feature keys (`uploadedFile`, `actionHistory`, `jobScheduler`) are fully opt-in; omitting them adds zero overhead.
