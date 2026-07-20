# Entry points

The package exposes exactly eight supported import paths. Use the narrowest path that owns the API
you need. Deep imports target build internals and are not part of the compatibility contract.

| Import | Main responsibility | Typical first symbol |
| --- | --- | --- |
| `@sdcorejs/nestjs` | Composition and common cross-cutting primitives | `SdCoreModule` |
| `@sdcorejs/nestjs/core` | ORM, request context, tenancy, audit | `BaseRepository` |
| `@sdcorejs/nestjs/auth` | JWT/JWKS, permission checks, internal calls | `JwtModule` |
| `@sdcorejs/nestjs/services` | Cache and outbound HTTP | `CacheModule` |
| `@sdcorejs/nestjs/validation` | Zod v4 parsing and guards | `ZodValidationGuard` |
| `@sdcorejs/nestjs/queue` | BullMQ module and worker adapter | `QueueModule` |
| `@sdcorejs/nestjs/i18n` | Catalogs, language resolution, exception filter | `I18nModule` |
| `@sdcorejs/nestjs/features` | Files, action history, distributed job leases | `UploadedFileModule` |

Both `import` and `require` resolve to dedicated ESM/CJS output with matching declarations. Do not
import paths such as `@sdcorejs/nestjs/orm`, `/cache`, `/jwt`, or source files below `/dist`.

```ts
import { SdCoreModule } from '@sdcorejs/nestjs';
import { BaseEntity, BaseRepository, Scoped, WithAudit } from '@sdcorejs/nestjs/core';
import { AuthGuard, HasPermission, JwtModule } from '@sdcorejs/nestjs/auth';
import { CacheModule, HttpClientModule } from '@sdcorejs/nestjs/services';
```

See the [API catalog](/api/) for every value and type exported by each path.

## Optional runtimes

Optional dependencies are installed non-fatally by npm, but an application only needs the runtime
for the feature it enables:

| Feature | Runtime |
| --- | --- |
| Redis cache / BullMQ connection | `ioredis` |
| OIDC/JWKS verification | `jwks-rsa` and `jsonwebtoken` |
| S3 uploaded-file driver | `@aws-sdk/client-s3` |

Missing optional runtimes fail when their feature is constructed or first used; they do not change
the public import path. Zod v4 is a required dependency because validation helpers are exported from
both the root and `/validation` entry points.
