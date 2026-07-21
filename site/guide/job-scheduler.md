# Job scheduler and idempotency

`JobSchedulerService` is a PostgreSQL-backed distributed lease for cron and run-once jobs. When
every application instance races the same logical identity, one database claim wins and the others
return without running.

## Enable the feature

```ts
import { SdCoreModule } from '@sdcorejs/nestjs';

SdCoreModule.forRoot({
  jobScheduler: {},
});
```

Register the exported `JobScheduler` entity through `autoLoadEntities: true` or an explicit
TypeORM entity list and migration. Its unique `lockKey` is part of the concurrency guarantee.

## Recurring cron

```ts
import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  JobSchedulerService,
  JobSchedulerType,
} from '@sdcorejs/nestjs/features';

@Injectable()
class OrderSyncJob {
  constructor(private readonly jobs: JobSchedulerService) {}

  @Cron('*/5 * * * *')
  async tick(): Promise<void> {
    const bucketMs = 5 * 60_000;
    const bucketStart = new Date(Math.floor(Date.now() / bucketMs) * bucketMs);
    const runKey = bucketStart.toISOString();

    await this.jobs.runExclusive(
      {
        code: 'sync-orders',
        runKey,
        type: JobSchedulerType.SCHEDULE,
      },
      async (lease) => {
        await this.syncOneTick(lease.idempotencyKey);
      },
    );
  }

  private async syncOneTick(idempotencyKey: string): Promise<void> {
    // Pass this stable logical-run key to an outbox/deduplication boundary.
    process.stdout.write('sync ' + idempotencyKey + '\n');
  }
}
```

Every node must derive the same `runKey` for the same scheduled tick. Prefer the scheduler's intended
fire time when it is available. The fallback above floors wall-clock time to an exact five-minute
UTC bucket; keep worker clocks synchronized so nodes near a bucket boundary cannot disagree.

The stable key starts with `v2:`. Store that raw value in the outbox/payload, but do not pass it
directly as a BullMQ custom `jobId` because BullMQ rejects `:`. Derive a deterministic colon-free
base64url/hex hash when the queue also needs a deduplication ID.

## Run once

```ts
await jobs.runExclusive(
  {
    code: 'seed-default-settings',
    type: JobSchedulerType.INITIAL,
  },
  async ({ idempotencyKey }) => seedDefaults(idempotencyKey),
);
```

This focused snippet assumes injected `jobs` and application function `seedDefaults`. `INITIAL`
forbids `runKey`; a successful row remains locked permanently. `SCHEDULE` requires a nonblank
`runKey`. Identity values are trimmed and encoded as a versioned SHA-256 key.

## Lease behavior

1. A fresh claim uses `INSERT ... ON CONFLICT DO NOTHING RETURNING id`.
2. A conflicting `SUCCESS` or live `RUNNING` row is not acquired.
3. A `FAIL` row or expired `RUNNING` row may be atomically reclaimed.
4. Every claim rotates `ownerToken`; stale workers cannot heartbeat/finalize a reclaimed row.
5. `runExclusive` heartbeats, executes the callback, and records success/failure for the current
   owner.

The callback receives:

```ts
interface JobExecutionLease {
  id: string;
  ownerToken: string;
  idempotencyKey: string;
}
```

`idempotencyKey` is stable for the logical `{ type, code, runKey }` execution, including after
lease reclamation. `ownerToken` is intentionally unstable and is only a lease-fencing capability.
Do not use the database row ID or owner token as an external deduplication key.

## Timing

| Option | Default | Rule |
| --- | --- | --- |
| `leaseMs` | 15 minutes | safe integer greater than 2 |
| `heartbeatMs` | min(60 seconds, lease/3) | 0 or a safe integer below lease/2 |

Set the lease above realistic stalls and the heartbeat comfortably below half the lease:

```ts
await jobs.runExclusive(
  {
    code: 'nightly-import',
    runKey: new Date().toISOString().slice(0, 10),
    type: JobSchedulerType.SCHEDULE,
    leaseMs: 2 * 60 * 60 * 1_000,
    heartbeatMs: 30_000,
  },
  async ({ idempotencyKey }) => importNightly(idempotencyKey),
);
```

This focused fragment assumes `jobs`, `JobSchedulerType`, and application function
`importNightly`. Set `heartbeatMs: 0` only for work guaranteed to finish well inside the lease.

## Not exactly-once

A worker can perform an external effect, lose its lease, and fail before recording success. Another
worker can then reclaim the same logical run. Database fencing therefore does not make external
effects exactly-once.

Use `lease.idempotencyKey` as a unique key in one of these application-owned boundaries:

- a transactional outbox row committed with database changes;
- an inbox/deduplication table at the consumer;
- an idempotency header supported by the downstream API; or
- a unique business operation record.

See [Scheduled jobs example](/examples/scheduled-jobs) for an outbox-shaped workflow.

## Manual lease API

`acquire()` returns `{ acquired: false }` for a loser or
`{ acquired: true, id, ownerToken, idempotencyKey }` for a winner. Manual callers can use
`heartbeat()`, `complete()`, `fail()`, and `release()` with `{ id, ownerToken }`.
`release()` marks the row failed so a later acquire may retry. Prefer `runExclusive()` unless you
need explicit lifecycle control, and always finalize in error paths.
