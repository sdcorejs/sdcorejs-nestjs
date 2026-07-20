# Compile-checked NestJS 11 consumer

This directory is a realistic consumer of `@sdcorejs/nestjs` 1.1.0. It deliberately imports the
library only through its eight supported entrypoints:

- `@sdcorejs/nestjs`
- `@sdcorejs/nestjs/core`
- `@sdcorejs/nestjs/auth`
- `@sdcorejs/nestjs/services`
- `@sdcorejs/nestjs/validation`
- `@sdcorejs/nestjs/queue`
- `@sdcorejs/nestjs/i18n`
- `@sdcorejs/nestjs/features`

The example shows:

- PostgreSQL + TypeORM with `WithAudit(BaseEntity)` and a required `@Scoped()` tenant column;
- a `BaseRepository` that enforces tenancy and records action history;
- Keycloak JWKS verification, trusted principal-to-context mapping, role/permission resolution;
- a globally registered `CacheInterceptor`, tenant-safe `@Cached()` route and Redis backend;
- trusted-origin HTTP context propagation and Zod-validated controller input;
- uploaded-file, action-history, distributed job-scheduler and BullMQ root wiring;
- a scheduled cluster-safe job whose external effect is deduplicated with
  `lease.idempotencyKey` and a typed PostgreSQL outbox contract.

## Compile check

From the repository root:

```bash
npx tsc -p examples/tsconfig.json --noEmit
```

`tsconfig.json` maps the eight package entrypoints to this repository's source so API drift breaks
the check immediately. In a separate application, remove those `paths` mappings and install the
published package instead.

## Runtime dependencies

The example type-checks without contacting infrastructure, but running it requires:

- PostgreSQL for application, feature and outbox tables;
- Redis for cache and BullMQ;
- a Keycloak/OIDC issuer with JWKS and tokens containing `sub` plus `tenant_code`;
- the configured upstream catalog API;
- local writable storage by default, or S3 when `UPLOAD_DRIVER=s3`.

Start from [`.env.example`](./.env.example). Supply values through your process manager, container
environment or secret manager; the example does not load or embed credentials. `DB_SYNCHRONIZE`
is intended only for local development. Keep it `false` in production and apply migrations.

The S3 branch intentionally uses the AWS default credential chain. Do not put access keys in source
or committed environment files. For private uploads, keep `publicFiles` disabled (the default) and
serve downloads through authenticated application routes.

## Security flow

`ContextMiddleware` starts a request context without trusting identity headers. After Passport has
verified the token, `AuthGuard` invokes `mapKeycloakPrincipal`; only then are `userId`, tenant, roles
and permissions admitted into the context. `AppTenancyStrategy` maps that tenant to the entity's
`tenantCode`, so missing tenant claims fail closed on scoped repository operations.

The scheduled job's database lease prevents concurrent workers from winning the same logical run,
but lease ownership alone cannot make external effects exactly-once. The example therefore inserts
an outbox row under the stable `lease.idempotencyKey`. Its unique index makes a reclaimed run safe to
retry. A production outbox publisher should publish unsent rows and mark `publishedAt` only after the
broker acknowledges delivery.
