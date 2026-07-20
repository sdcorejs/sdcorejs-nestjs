# Database schema reference

The stateful features are PostgreSQL-oriented. The source uses `uuid`, `jsonb`, `timestamptz`, enum
columns, PostgreSQL intervals, `ON CONFLICT`, and database-clock expressions. Tests use `pg-mem`;
the project does not claim MySQL or SQLite compatibility and does not publish ready-to-run consumer
migrations.

## Common base entities

- `BaseEntity`: generated UUID primary key `id`.
- `WithTimestamps(Base)`: `createdAt`, `updatedAt`, nullable `deletedAt`.
- `WithAudit(Base)`: timestamps plus nullable `createdBy`, `modifiedBy`, `creator jsonb`, and
  `modifier jsonb`.
- `@Scoped()` does not create a column. Apply it to a real consumer `@Column()` property.

## `uploaded_file`

Key columns include generated UUID `id`; non-null `tenantCode` and `userId`; nullable
`departmentCode`; immutable `fileName`, `fileSize`, `fileExtension`, `key`, and `cdn`; usage and
provenance fields; optional `extraData jsonb`; nullable `uploadPendingAt` and `deletionPendingAt`;
and standard timestamps plus soft-delete time. `key` and `cdn` are unique.

Indexes cover tenant/department/owner/id, upload activation leases and pending deletion. A newly
persisted upload is hidden with a future `uploadPendingAt` lease while bytes are written; activation
clears its exact marker. `deletionPendingAt` is the storage-delete claim. Maintenance retains an
unresolved upload tombstone and scheduled deletion claim across soft deletion, including producer
process death. Failed deletion work is rescheduled to a future retry marker so bounded scans advance
past poison rows; only the settled writer path or explicit operator retirement clears the upload
tombstone.

## `action-history`

The `action-history` table stores UUID `id`, non-null `tenantCode`, `table` (up to 256), resource UUID
`tableId`, optional actor snapshot, enum action `type`, optional `fromData`/`toData jsonb`, note, and
`createdAt`. The resource index is `(tenantCode, table, tableId, createdAt)`.

`table` must be the authoritative schema-qualified TypeORM `tablePath`. The module records history;
`retentionDays` is an operations hint and does not schedule deletion.

## `job-scheduler`

The `job-scheduler` table stores a unique versioned SHA-256 `lockKey`, bounded `code`/`name`, job
type, status, rotating UUID `ownerToken`, optional `data jsonb`, and creation/modification times.
Indexes cover code and `(status, modifiedAt)`. Acquisition depends on PostgreSQL conflict handling
and stale-lease comparison against the database clock.

## Migration discipline

Register feature entities through `autoLoadEntities: true` or explicitly. In production, ship
application-owned migrations: add nullable columns, backfill/quarantine with authoritative ownership
data, validate, then add non-null and index constraints. Never rely on `synchronize: true` for a
production rollout. Follow the [1.0 → 1.1 migration](/migrations/1.0-to-1.1).
