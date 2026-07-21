# Configuration

`SdCoreModule.forRoot()` is the root composition API. Call it once in the application root unless a
feature guide explicitly shows a standalone module import.

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SdCoreModule } from '@sdcorejs/nestjs';
import { z } from 'zod';

const PrincipalSchema = z.object({
  sub: z.string().min(1),
  tenant: z.string().min(1).max(64),
  roles: z.array(z.string().min(1)).optional(),
});

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.DATABASE_URL,
      autoLoadEntities: true,
      synchronize: false,
    }),
    SdCoreModule.forRoot({
      context: {
        identity: {
          principalResolver: (principal: unknown) => {
            const claims = PrincipalSchema.parse(principal);
            return {
              userId: claims.sub,
              tenant: claims.tenant,
              roles: claims.roles,
            };
          },
        },
      },
      tenancy: {
        resolve: (ctx) => ({ tenantCode: ctx.tenant }),
      },
      cache: { backend: 'memory', ttl: 60, maxEntries: 1_000 },
      http: { timeout: 10_000, trustedOrigins: [] },
    }),
  ],
})
export class AppModule {}
```

## Always-on modules

These keys are optional because each module has defaults, but the modules are always composed:

| Key | Purpose | Important default |
| --- | --- | --- |
| `context` | AsyncLocalStorage request context | identity headers are not trusted |
| `tenancy` | scope strategy or callbacks | scoped entities fail closed |
| `audit` | audit-field strategy | fills IDs only when a verified user is present |
| `permission` | permission strategy | no permissions |
| `cache` | memory or Redis cache | in-process memory, 60-second TTL |
| `http` | Axios-based client | no identity propagation |

## Opt-in modules

These modules are registered only when their key is present:

| Key | Enables | Additional infrastructure |
| --- | --- | --- |
| `jwt` | symmetric JWT or JWKS/OIDC Passport strategy | secret or explicit issuer policy |
| `i18n` | catalogs and exception filter | optional custom resolver |
| `uploadedFile` | local/S3 file persistence | TypeORM entity; scheduler for cleanup |
| `actionHistory` | before/after audit history | TypeORM entity and read policy |
| `jobScheduler` | distributed database leases | PostgreSQL entity and unique index |
| `queue` | BullMQ connection and defaults | Redis |

When `uploadedFile`, `actionHistory`, or `jobScheduler` is enabled, keep
`autoLoadEntities: true` or list `UploadedFile`, `ActionHistory`, and `JobScheduler` explicitly in
your TypeORM data source. Use migrations in production; do not depend on `synchronize: true`.

## Extension providers

The `providers` array registers and re-exports application implementations for public DI tokens:

```ts
import { SdCoreModule, INTERNAL_SECRET_PROVIDER } from '@sdcorejs/nestjs';

SdCoreModule.forRoot({
  providers: [
    {
      provide: INTERNAL_SECRET_PROVIDER,
      useFactory: () => ({
        getKeys: () => [
          process.env.INTERNAL_SECRET_CURRENT,
          process.env.INTERNAL_SECRET_NEXT,
        ].filter((value): value is string => Boolean(value)),
        getKey: () => process.env.INTERNAL_SECRET_CURRENT ?? '',
      }),
    },
  ],
});
```

For the built-in environment-backed secret provider, use the shorter form:

```ts
SdCoreModule.forRoot({
  internalSecret: { envVar: 'INTERNAL_SECRET_KEY' },
});
```

The literal `{ key: '...' }` form is deprecated and is suitable only for isolated tests.

## Configuration checklist

1. Establish identity from a verified JWT or an explicitly verified gateway.
2. Return every required `@Scoped()` value from tenancy policy.
3. Register `CacheInterceptor` before expecting `@Cached()` to run.
4. Use exact trusted origins for outbound identity propagation.
5. Register database entities and migrations for enabled stateful features.
6. Mount feature controllers only when the application intends to expose their routes.
