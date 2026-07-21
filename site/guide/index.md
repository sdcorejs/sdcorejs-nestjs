# Guide

`@sdcorejs/nestjs` packages the infrastructure that multi-tenant NestJS services repeatedly need:
request context, tenancy enforcement, audit fields, permissions, JWT verification, caching, a safe
outbound HTTP client, validation, i18n, file storage, action history, distributed job leases, and
BullMQ integration.

The library supplies mechanisms. Your application still owns domain policy: how a verified
principal maps to a user and tenant, which permissions they have, which records they may see, and
which external side effects are idempotent.

## Choose a path

- New project: [Installation](/guide/installation) → [Configuration](/guide/configuration) →
  [Complete application](/examples/complete-app).
- Multi-tenant CRUD: [Request context](/guide/request-context) →
  [Multi-tenancy](/guide/multi-tenancy) → [ORM base classes](/guide/orm-base-classes).
- Authentication: [JWT and Keycloak](/guide/jwt-keycloak) →
  [Identity and permissions example](/examples/identity-and-permissions).
- Stateful features: [Uploaded files](/guide/uploaded-files),
  [action history](/guide/action-history), and [job scheduler](/guide/job-scheduler).
- Production review: [Database and PostgreSQL](/guide/database) and the 1.1.0 security
  migration guide linked from the documentation navigation.

## Public imports

Use only the package root and its seven documented subpaths:

```ts
import { SdCoreModule } from '@sdcorejs/nestjs';
import { BaseRepository, ContextService } from '@sdcorejs/nestjs/core';
import { AuthGuard, HasPermission } from '@sdcorejs/nestjs/auth';
import { CacheService, HttpService } from '@sdcorejs/nestjs/services';
import { ZodValidationGuard } from '@sdcorejs/nestjs/validation';
import { QueueModule } from '@sdcorejs/nestjs/queue';
import { I18N_RESOLVER } from '@sdcorejs/nestjs/i18n';
import { UploadedFileService } from '@sdcorejs/nestjs/features';
```

Deep imports into `dist`, `src`, or a feature's internal folder are not part of the compatibility
contract.
