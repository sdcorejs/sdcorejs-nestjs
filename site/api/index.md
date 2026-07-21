# API reference

This reference documents the public exports of `@sdcorejs/nestjs`. Import from the narrowest
entrypoint that owns the API; the package root intentionally exposes only the bootstrap module and
the most common integration contracts.

## Public entrypoints

| Import path | Contents |
| --- | --- |
| [`@sdcorejs/nestjs`](./root.md) | `SdCoreModule`, root configuration, common DI tokens, guards, response and validation helpers |
| [`@sdcorejs/nestjs/core`](./core/orm.md) | TypeORM base classes, request context, tenancy and audit |
| [`@sdcorejs/nestjs/auth`](./auth/jwt.md) | Symmetric JWT, JWKS/OIDC, permissions and internal-call guards |
| [`@sdcorejs/nestjs/services`](./services/cache.md) | Cache backends/interceptor and trusted-origin HTTP client |
| [`@sdcorejs/nestjs/validation`](./validation.md) | Zod parsing, request guards and query presets |
| [`@sdcorejs/nestjs/i18n`](./i18n.md) | Language resolution, catalogs and exception localization |
| [`@sdcorejs/nestjs/queue`](./queue.md) | BullMQ bootstrap, worker base class and queue primitives |
| [`@sdcorejs/nestjs/features`](./features/uploaded-files.md) | Uploaded files, action history and database job locks |

## Import rules

```ts
// Common bootstrap API
import { SdCoreModule, ContextService } from '@sdcorejs/nestjs';

// Full specialist surfaces
import { BaseRepository, Scoped } from '@sdcorejs/nestjs/core';
import { KeycloakJwtStrategy } from '@sdcorejs/nestjs/auth';
import { CacheService } from '@sdcorejs/nestjs/services';
```

All entrypoints support ESM and CommonJS and publish their own TypeScript declarations. The library
requires Node.js 20 or later and NestJS 11.

## Behavioral defaults worth knowing

- Repository pages are **zero-based**. Missing `pageNumber` becomes `0`; missing or non-positive
  `pageSize` becomes `10`; the hard maximum is `200`.
- Scoped TypeORM entities fail closed when their required tenancy context is unavailable.
- `detail()` excludes soft-deleted rows by default. Pass `{ withDeleted: true }` only in an
  authorized recovery/administrative path.
- JWT is opt-in. JWKS mode requires an issuer policy; symmetric mode requires `secret`.
- `@Cached()` does nothing unless `CacheInterceptor` is registered on the route/controller or as a
  global interceptor.
- The ORM search/filter implementation and the built-in stateful feature entities target
  PostgreSQL. See [PostgreSQL behavior](./core/orm.md#postgresql-behavior).

## Response and error convention

Library controllers return `{ data }` and library HTTP errors carry a stable `{ code, message,
data? }` body. When `I18nModule` is enabled, its global filter converts those failures to
`{ error: { code, message, data? } }`.

```ts
import { ApiResponse, apiError } from '@sdcorejs/nestjs';
import { BadRequestException } from '@nestjs/common';

return ApiResponse.ok({ id: '...' });
throw new BadRequestException(apiError('catalog.product.invalid', 'Invalid product'));
```

## Security model

The APIs distinguish trusted identity from untrusted transport input. JWT claims become request
identity only after Passport verification; identity headers are accepted only through explicitly
verified trusted-header mode. Tenancy filters, file access policy and action-history authorization
are enforced in services/repositories, not merely in controllers. APIs prefixed `unsafe` are
maintenance or raw-database escape hatches and must not be exposed to ordinary requests.
