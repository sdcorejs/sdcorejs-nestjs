# Job scheduler API

Import path: `@sdcorejs/nestjs/features`

The job scheduler is a PostgreSQL-backed distributed lease. Nodes competing for the same logical
run use one unique lock row; only the winner executes. This coordinates execution but does not make
external side effects exactly-once.

## Exports

| Export                                            | Kind                | Purpose                                                                                 |
| ------------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------- |
| `JobScheduler`                                    | entity class        | `job-scheduler` lease row                                                               |
| `JobSchedulerStatus`                              | enum                | `RUNNING`, `SUCCESS`, `FAIL`                                                            |
| `JobSchedulerType`                                | enum                | `INITIAL`, `SCHEDULE`                                                                   |
| `JobAcquireOptions`                               | interface           | Logical identity and lease timing                                                       |
| `JobAcquireResult`                                | discriminated union | `acquired: true` includes the required row/token/idempotency key; `false` includes none |
| `JobLease`                                        | interface           | `{ id, ownerToken }` fencing capability                                                 |
| `JobExecutionLease`                               | interface           | `JobLease` plus required stable `idempotencyKey`                                        |
| `RunExclusiveResult<T>`                           | interface           | `{ acquired, result? }`                                                                 |
| `DEFAULT_LEASE_MS`                                | value               | 15 minutes                                                                              |
| `DEFAULT_HEARTBEAT_MS`                            | value               | Maximum default interval: 60 seconds                                                    |
| `LostJobLeaseError`                               | class               | Winner lost ownership before finalization                                               |
| `InvalidJobLeaseOptionsError`                     | class               | Unsafe lease/heartbeat timing                                                           |
| `InvalidJobIdentityOptionsError`                  | class               | Ambiguous code/type/runKey identity                                                     |
| `JobSchedulerService`                             | class               | Acquire, fence, finalize and run callback API                                           |
| `JobSchedulerModule`, `JobSchedulerModuleOptions` | class/type          | Feature registration                                                                    |

## Entity and module setup

```ts
TypeOrmModule.forRoot({
  type: 'postgres',
  // ...
  entities: [JobScheduler],
});

JobSchedulerModule.forRoot({ global: true });
```

Add the entity and apply its schema/unique `lockKey` constraint before running jobs. `global`
defaults to `true`. The implementation uses PostgreSQL `ON CONFLICT DO NOTHING`, `RETURNING`,
`CURRENT_TIMESTAMP`, interval casts, UUID, enum and JSONB behavior.

## Logical job identity

```ts
interface JobAcquireOptions {
  code: string;
  runKey?: string;
  name?: string;
  type?: JobSchedulerType;
  leaseMs?: number;
  heartbeatMs?: number;
}
```

- `code` is trimmed and must contain 1–64 characters.
- Type defaults to `SCHEDULE`.
- `SCHEDULE` requires a nonblank `runKey` of at most 1,024 characters. Every node must use the same
  key for the same tick, for example `2026-07-20T03:00:00Z`.
- `INITIAL` forbids `runKey`, producing one canonical run-once lock for the code.
- Runtime validation also rejects non-string `code`/`runKey` values and unknown `type` values with
  `InvalidJobIdentityOptionsError` before issuing SQL, including calls from untyped JavaScript.
- Omit lease fields to use defaults; explicit `null`, non-number and unsafe-integer timing values
  raise `InvalidJobLeaseOptionsError` rather than being treated as omitted.
- Identity is encoded as a versioned SHA-256 key beginning `v2:`. Raw components are not stored in
  the unique key.

## `runExclusive`

```ts
const outcome = await jobs.runExclusive(
  {
    code: 'sync-orders',
    name: 'Sync orders from ERP',
    type: JobSchedulerType.SCHEDULE,
    runKey: tick.toISOString(),
    leaseMs: 15 * 60_000,
  },
  async ({ idempotencyKey }) => {
    return outbox.enqueueOnce({
      idempotencyKey,
      type: 'erp-order-sync',
      payload: { tick: tick.toISOString() },
    });
  },
);

if (!outcome.acquired) return; // another node owns or completed this logical run
```

Signature:

```ts
runExclusive<T>(
  options: JobAcquireOptions,
  fn: (lease: JobExecutionLease) => Promise<T>,
): Promise<RunExclusiveResult<T>>
```

The winner receives an unpredictable `ownerToken` and a stable `idempotencyKey`. Reclaiming a stale
lease rotates the owner token but retains the same idempotency key for the logical
`{ type, code, runKey }` execution. Use that stable key in a unique outbox/business deduplication
record before performing external effects.

`idempotencyKey` begins with `v2:`. Keep the raw value for outbox/business deduplication; if it must
also become a BullMQ custom `jobId`, first derive a deterministic colon-free hash because BullMQ
rejects `:` in custom IDs.

On callback success, `runExclusive` marks the currently owned lease `SUCCESS`. On failure it marks
it `FAIL` and rethrows. If ownership was reclaimed before finalization, it throws
`LostJobLeaseError`. A former owner cannot heartbeat or finalize after its token is rotated.

::: warning External side effects
The database lease is single-owner at each instant, not exactly-once. A worker can send an email or
call another system, then lose its lease before recording success. Always make those effects
idempotent with `idempotencyKey` and a unique outbox/deduplication constraint.
:::

## Manual lease API

```ts
const lock = await jobs.acquire(options);
if (!lock.acquired || !lock.id || !lock.ownerToken || !lock.idempotencyKey) return;

const lease = { id: lock.id, ownerToken: lock.ownerToken };
try {
  await work(lock.idempotencyKey);
  if (!(await jobs.complete(lease, { rows: 42 }))) {
    throw new LostJobLeaseError(lock.id);
  }
} catch (error) {
  await jobs.fail(lease, { error: String(error) });
  throw error;
}
```

| Method                   | Behavior                                                                                     |
| ------------------------ | -------------------------------------------------------------------------------------------- |
| `acquire(options)`       | Fresh atomic insert, otherwise reclaim `FAIL` or expired `RUNNING`; `SUCCESS` remains locked |
| `heartbeat(lease)`       | Bumps database `modifiedAt` only for current `RUNNING` owner                                 |
| `complete(lease, data?)` | Sets `SUCCESS` and optional JSON data; false if ownership lost                               |
| `fail(lease, data?)`     | Sets `FAIL`; false if ownership lost                                                         |
| `release(lease, data?)`  | Alias for fail, default `{ released: true }`, making next acquire eligible                   |

## Lease timing

`leaseMs` defaults to 15 minutes and must be a positive safe integer greater than 2. Default
heartbeat is the smaller of 60 seconds and one third of the lease. Explicit `heartbeatMs` must be a
non-negative safe integer and, when nonzero, strictly less than half the lease. `0` disables
heartbeats and is safe only for jobs guaranteed to finish well inside the lease.

`runExclusive` starts/stops the heartbeat automatically. Manual `acquire` callers own heartbeat and
finalization themselves.

## Failure and retry semantics

A `FAIL` row is immediately reclaimable. A `RUNNING` row becomes reclaimable only when its
database `modifiedAt` is older than the configured lease according to the database clock. A
`SUCCESS` row is never reclaimed for the same logical identity. Use a new `runKey` for each intended
scheduled occurrence.

The scheduler does not transport work or retain a queue backlog. Use [BullMQ](../queue.md) when you
need delayed jobs, retries, concurrency and worker delivery; combine both only when their distinct
roles are clear.
