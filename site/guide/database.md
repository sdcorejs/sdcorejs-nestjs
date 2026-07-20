# Database and PostgreSQL

The complete library surface is PostgreSQL-oriented. TypeORM abstracts basic entity access, but the
following public behaviors use PostgreSQL-specific types or SQL:

- `WithAudit` stores `creator` and `modifier` as `jsonb`.
- uploaded files and action history store metadata/snapshots as `jsonb`.
- job scheduler uses enum/jsonb columns, `INSERT ... ON CONFLICT ... RETURNING`, the database clock,
  and PostgreSQL interval casts.
- `BaseRepository.import()` uses `RETURNING '*'`.
- contains-search uses `UNACCENT(...)`, PostgreSQL casts, and `NULLS FIRST/LAST` ordering.

Basic unscoped TypeORM operations may happen to work on another driver, but this project does not
claim full cross-database support. Run your own integration suite before using a different driver;
the job scheduler in particular should be treated as PostgreSQL-only.

## Recommended data source

```ts
import { TypeOrmModule } from '@nestjs/typeorm';

TypeOrmModule.forRoot({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  autoLoadEntities: true,
  synchronize: false,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: true }
    : undefined,
});
```

Use your platform's verified CA configuration rather than disabling TLS verification.

## `unaccent` extension

`@SearchableFields({ contain: [...] })` generates `UNACCENT` expressions. Enable the extension in a
migration before using contains-search:

```sql
CREATE EXTENSION IF NOT EXISTS unaccent;
```

Exact search and UUID lookup do not need `unaccent`.

## Migrations for library entities

When you enable stateful modules, generate and review migrations for their exported entities:

```ts
import {
  ActionHistory,
  JobScheduler,
  UploadedFile,
} from '@sdcorejs/nestjs/features';

export const libraryEntities = [UploadedFile, ActionHistory, JobScheduler];
```

The exact schema depends on your TypeORM naming strategy and data-source schema. Generate migrations
inside the consuming application; the library cannot safely ship one universal SQL migration.

## Transaction rules

Scoped multi-step mutations create their own transaction when no `QueryRunner` is passed. If you
pass a runner to a scoped mutation, it must already have an active transaction or
`InactiveMutationTransactionError` is raised. This avoids splitting scope verification and
mutation across different transaction boundaries.

The raw APIs `unsafeRepository`, `unsafeGetRepository()`, and `unsafeCreateQueryRunner()` bypass
tenancy and affected-row protection. Keep them behind a reviewed maintenance boundary.

## Paging and query limits

- Pages are 0-based (`pageNumber: 0` is the first page).
- `BaseRepository.paging()` defaults to 10 rows and caps `pageSize` at 200.
- `all()` is deliberately unbounded and is not exposed by `BaseController`.
- Generic search returns at most 20 rows.
- Action-history paging has a configurable limit that can never exceed 200.
