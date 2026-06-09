# Feature modules

Three **stateful** modules ship from `@sdcorejs/nestjs/features`. Each is opt-in — wired only when its
key is present in `SdCoreModule.forRoot({...})` — and each exports an entity you register with TypeORM
(`autoLoadEntities: true` or explicit listing). The two HTTP controllers are **drop-in but NOT
auto-registered**: add them to one of *your* modules' `controllers` array so they inherit that module's
route prefix.

## Uploaded files

```ts
SdCoreModule.forRoot({
  uploadedFile: {
    // driver auto-detected: 's3' when creds present, else 'local'
    bucket: process.env.S3_BUCKET,
    accessId: process.env.S3_ACCESS_ID,
    accessKey: process.env.S3_ACCESS_KEY,
    cdnBaseUrl: process.env.S3_CDN,        // builds the returned `cdn` field
    folder: 'core',                        // permanent-file prefix (default 'core')
    cleanupAfterDays: 7,                   // opt-in 03:00 cron purge of never-attached files
  },
});
```

`UploadedFileService` is globally provided — inject it anywhere:

```ts
const file = await uploads.upload(buffer, 'invoice.pdf', { module: 'crm', entity: 'order', entityId });
const { stream, fileName } = await uploads.download(file.id);
await uploads.setExtraData<{ ocr: string }>(file.id, { ocr: 'parsed text' });
```

- **`UploadedFile<TExtraData>`** — generic entity with an `extraData` jsonb bag; type it per call.
- **Service** — `upload<T>(buffer, fileName?, meta?, extraData?)` → full row; `download(id)` →
  `{ stream, fileName }`; `findById<T>(id)`; `setExtraData<T>(id, data)`; plus `useFiles` / `markUsed` /
  `delete`.
- **Drop-in `UploadedFileController`** — `POST /uploaded-file` (multipart field `file`; optional
  `module` / `entity` / `entityId` / `type` query params) and `GET /uploaded-file/:id/download`. Guarded
  by `AuthGuard`; needs `@nestjs/platform-express`. Mount it under your prefix:

  ```ts
  import { UploadedFileController } from '@sdcorejs/nestjs/features';

  @Module({ controllers: [UploadedFileController] }) // a module routed under `core`
  export class CoreModule {}                          // → POST /core/uploaded-file, GET /core/uploaded-file/:id/download
  ```

- **`cleanupAfterDays`** — when set (`> 0`), a fixed `@Cron('0 3 * * *')` purges never-attached files
  (`isUsed = false`) older than N days. Requires `ScheduleModule.forRoot()` in the host. When the
  `jobScheduler` feature is also wired, each sweep takes the distributed DB lock so only one instance
  purges; otherwise it runs directly. Omit (or `<= 0`) to disable — nothing is deleted.

## Action history

Records per-entity change history and reads it back. The acting user is resolved per request from
`ContextService` (default `ctx.userId`) or a consumer `resolveActor(ctx)`.

```ts
SdCoreModule.forRoot({
  actionHistory: { resolveActor: (ctx) => ({ userId: ctx.userId, username: ctx.user?.email }) },
});
```

- **`ActionHistoryService`** — `record(entry)` (called automatically by `BaseRepository` CUD when
  `logHistory` is enabled) and `all(tableId)` → newest-first DTO list.
- **Drop-in `ActionHistoryController`** — `GET /action-history/:tableId`. Guarded by `AuthGuard`; mount
  it under your prefix the same way as `UploadedFileController` (→ `GET /core/action-history/:tableId`).

## Job scheduler — distributed cron lock

Across N scaled nodes firing the same scheduled job, `runExclusive` guarantees a single winner runs it.

```ts
import { JobSchedulerService, JobSchedulerType } from '@sdcorejs/nestjs/features';

@Cron('*/5 * * * *')
async syncOrders() {
  const { acquired } = await this.jobs.runExclusive(
    { code: 'sync-orders', runKey: thisTickIso, type: JobSchedulerType.SCHEDULE },
    () => this.doSync(),
  );
  // every other node returns { acquired: false } and does nothing
}
```

### How the lock works

1. `INSERT ... ON CONFLICT DO NOTHING RETURNING id` — wins if no row exists for `lockKey`.
2. On conflict, re-claims:
   - A `FAIL` row — transient failure can be retried on the next fire.
   - A `RUNNING` row whose `modifiedAt` is older than `leaseMs` — the node that held it crashed.
   - `SUCCESS` rows stay locked permanently (run-once semantics for `INITIAL` jobs).
3. The winner runs `fn`, records `SUCCESS` or `FAIL`, and returns the result.

### Heartbeat — preventing false stale-lease reclaims

`runExclusive` bumps `modifiedAt` on the lock row every `heartbeatMs` (default **60 s**) while `fn`
is running. This keeps the row inside its lease window so a live-but-slow job is never reclaimed by
another node. Only disable heartbeating (`heartbeatMs: 0`) for jobs guaranteed to finish in less than
`leaseMs`.

### `JobAcquireOptions`

| Option | Type | Default | Description |
|---|---|---|---|
| `code` | `string` | required | Stable job identifier |
| `runKey` | `string` | — | Per-tick discriminator for `SCHEDULE` jobs (e.g. ISO timestamp truncated to the cron period) |
| `type` | `JobSchedulerType` | `SCHEDULE` | `SCHEDULE` (recurring) or `INITIAL` (run-once) |
| `leaseMs` | `number` | `900_000` (15 min) | Stale-lock window. Set above worst-case job runtime + heartbeat interval. |
| `heartbeatMs` | `number` | `60_000` (60 s) | How often to touch `modifiedAt`. Set below `leaseMs / 2`. Set `0` to disable. |

```ts
// Long-running nightly import — widen the lease, tighten the heartbeat.
await this.jobs.runExclusive(
  {
    code: 'nightly-import',
    runKey: dayIso,
    type: JobSchedulerType.SCHEDULE,
    leaseMs: 2 * 60 * 60 * 1000,  // 2 hours
    heartbeatMs: 30_000,           // touch every 30 s
  },
  () => this.doImport(),
);
```

Enable with `jobScheduler: {}`.

::: warning Register the entity
`JobScheduler` must be registered with TypeORM — either via `autoLoadEntities: true` or explicit listing.
`ScheduleModule.forRoot()` is needed when the `uploadedFile.cleanupAfterDays` cleanup cron is also active.
:::
