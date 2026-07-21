# Getting started

This walkthrough boots the shared infrastructure, establishes verified identity, scopes TypeORM
repositories, and installs response caching. Read [Installation](/guide/installation) first.

## Root module

```ts
import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SdCoreModule } from '@sdcorejs/nestjs';
import { CacheInterceptor } from '@sdcorejs/nestjs/services';
import { z } from 'zod';

const AccessTokenClaimsSchema = z.object({
  sub: z.string().min(1),
  tenant: z.string().min(1).max(64),
  roles: z.array(z.string().min(1)).optional(),
});

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const jwtSecret = requiredEnv('JWT_SECRET');
const jwtIssuer = requiredEnv('JWT_ISSUER');
const jwtAudience = requiredEnv('JWT_AUDIENCE');

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.DATABASE_URL,
      autoLoadEntities: true,
      synchronize: false,
    }),
    ScheduleModule.forRoot(),
    SdCoreModule.forRoot({
      context: {
        identity: {
          principalResolver: (principal: unknown) => {
            const claims = AccessTokenClaimsSchema.parse(principal);
            return {
              userId: claims.sub,
              tenant: claims.tenant,
              roles: claims.roles,
            };
          },
        },
      },
      tenancy: {
        resolve: (context) => ({ tenantCode: context.tenant }),
      },
      jwt: { secret: jwtSecret, issuer: jwtIssuer, audience: jwtAudience },
      cache: { backend: 'memory', ttl: 60, maxEntries: 1_000 },
      http: { timeout: 10_000, trustedOrigins: [] },
      i18n: {
        supportedLanguages: ['en', 'vi'],
        fallbackLanguage: 'en',
      },
    }),
  ],
  providers: [
    { provide: APP_INTERCEPTOR, useExisting: CacheInterceptor },
  ],
})
export class AppModule {}
```

Use a reviewed migration instead of `synchronize: true` in deployed environments. The cache
interceptor provider is required; `@Cached()` is metadata only until an interceptor is installed.

## Add a scoped entity

```ts
import { Column, Entity, Index } from 'typeorm';
import {
  BaseEntity,
  Scoped,
  SearchableFields,
  WithAudit,
} from '@sdcorejs/nestjs/core';

@SearchableFields({ exact: ['sku'], contain: ['name'] })
@Entity('product')
@Index(['tenantCode', 'sku'], { unique: true })
export class Product extends WithAudit(BaseEntity) {
  @Column() @Scoped() tenantCode!: string;
  @Column() sku!: string;
  @Column() name!: string;
}
```

Every `BaseRepository<Product>` read and mutation now needs a valid `tenantCode` from the tenancy
strategy. Create/import fills it from context; ordinary update cannot change it.

## Choose the next example

- [Complete application](/examples/complete-app) connects entity, repository, service, controller,
  authentication, and testing.
- [Tenant CRUD](/examples/tenant-crud) focuses on the base ORM stack.
- [Identity and permissions](/examples/identity-and-permissions) configures Keycloak/JWT and route
  authorization.
- [Cache and HTTP](/examples/cache-and-http) covers cache namespaces and trusted outbound propagation.

## Before production

1. Follow the [1.0 → 1.1 migration](/migrations/1.0-to-1.1).
2. Confirm PostgreSQL requirements in [Database](/guide/database).
3. Use an explicit JWKS issuer policy or a strong symmetric secret.
4. Never accept identity headers without a verified [gateway boundary](/guide/trusted-gateway).
5. Give every public route authentication, permission, validation, and resource-level policy.
6. Run unit, integration, E2E, package, and documentation build gates.
