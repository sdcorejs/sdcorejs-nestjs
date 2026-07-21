# Installation

## Requirements

- Node.js 20 or newer.
- NestJS 11 (`@nestjs/common` and `@nestjs/core` are peer dependencies).
- TypeScript decorators and `reflect-metadata`, as required by NestJS and TypeORM.
- PostgreSQL for the full ORM and stateful-feature surface. See
  [Database and PostgreSQL](/guide/database) for the exact boundaries.

Install the package:

```bash
npm install @sdcorejs/nestjs
```

The package installs its runtime dependencies, including TypeORM, Passport, BullMQ, Axios, Zod v4,
and the NestJS integration packages. The following dependencies are optional at runtime and are
needed only when you enable the corresponding capability:

```bash
# Redis cache
npm install ioredis

# Keycloak/OIDC JWKS verification
npm install jwks-rsa jsonwebtoken

# S3 uploaded-file driver (AWS SDK v3)
npm install @aws-sdk/client-s3
```

The current package declares these as optional dependencies, so a normal npm installation usually
installs them. Listing them explicitly in an application makes the runtime requirement visible and
lets your lockfile control their versions.

## TypeScript setup

Use the standard NestJS decorator settings:

```json
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "strict": true
  }
}
```

Import `reflect-metadata` once at process startup if your bootstrap does not already do so:

```ts
import 'reflect-metadata';
```

## Verify the installation

Create the smallest module first:

```ts
import { Module } from '@nestjs/common';
import { SdCoreModule } from '@sdcorejs/nestjs';

@Module({
  imports: [SdCoreModule.forRoot()],
})
export class AppModule {}
```

This enables the always-on context, tenancy, audit, permission, cache, and HTTP modules. Security
sensitive behavior still fails closed: a scoped entity needs a tenancy strategy, `AuthGuard` needs a
Passport `jwt` strategy, and `InternalGuard` needs a secret provider.

## Version upgrades

Pin the version range according to your deployment policy and read both `CHANGELOG.md` and the
versioned migration guide before upgrading. Version 1.1.0 intentionally tightens several security
defaults, so existing applications should follow the 1.1.0 migration guide.
