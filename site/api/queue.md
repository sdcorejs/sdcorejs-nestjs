# BullMQ queue API

Import path: `@sdcorejs/nestjs/queue`

The queue package wraps `@nestjs/bullmq` root/feature registration, applies bounded retry/retention
defaults and supplies a worker base class that preserves BullMQ retry semantics.

## Exports

| Export | Kind | Purpose |
| --- | --- | --- |
| `QueueConnectionConfig` | interface | Redis/ioredis connection options |
| `QueueModuleConfig` | interface | Connection, prefix and default job options |
| `DEFAULT_JOB_OPTIONS` | value | Shipped retry/backoff/retention defaults |
| `DEFAULT_QUEUE_PREFIX` | value | `'sdcore:queue'` |
| `QueueModule` | class | `forRoot(config)` and `registerQueue(...names)` |
| `SdWorkerHost<TData, TResult>` | abstract class | Logged worker with abstract `handle(job)` |
| `Processor`, `InjectQueue`, `OnWorkerEvent`, `OnQueueEvent` | decorators | Re-exported from `@nestjs/bullmq` |
| `Job`, `Queue`, `Worker`, `JobsOptions` | types | Type-only re-exports of BullMQ primitives |

The third-party re-exports let queue consumers use one import path; their behavior and broader API
remain defined by BullMQ and `@nestjs/bullmq`.

## Root and feature registration

```ts
@Module({
  imports: [
    QueueModule.forRoot({
      connection: {
        host: 'redis.internal.example',
        port: 6379,
        db: 3,
      },
      prefix: 'orders:queue',
      defaultJobOptions: {
        attempts: 5,
      },
    }),
  ],
})
export class AppModule {}
```

Call `forRoot` once. In every feature that produces or consumes a named queue:

```ts
@Module({
  imports: [QueueModule.registerQueue('emails', 'exports')],
  providers: [EmailsWorker, EmailProducer],
})
export class EmailModule {}
```

Root `defaultJobOptions` merge over these defaults:

```ts
{
  attempts: 3,
  backoff: { type: 'exponential', delay: 1000 },
  removeOnComplete: 1000,
  removeOnFail: 5000,
}
```

The queue prefix defaults to `sdcore:queue`. Use a distinct prefix per application/environment and
prefer a Redis DB separate from general caching.

## Producer

```ts
@Injectable()
export class EmailProducer {
  constructor(@InjectQueue('emails') private readonly queue: Queue) {}

  enqueueWelcome(userId: string) {
    return this.queue.add(
      'welcome',
      { userId },
      {
        jobId: `welcome-${userId}`,
        delay: 5_000,
      },
    );
  }
}
```

Per-job options override root defaults according to BullMQ behavior. Custom BullMQ job IDs must not
contain `:`; use a safe delimiter or a stable hash of multi-part business identities.

## Worker

```ts
@Processor('emails', { concurrency: 5 })
export class EmailsWorker extends SdWorkerHost<{ userId: string }, void> {
  constructor(private readonly mailer: Mailer) {
    super();
  }

  async handle(job: Job<{ userId: string }>): Promise<void> {
    await this.mailer.sendWelcome(job.data.userId);
  }
}
```

Override `handle`, not `process`. `SdWorkerHost.process` logs queue/name/id and attempt, then
rethrows failures so BullMQ records the attempt and applies retry/backoff. Swallowing errors in
`handle` reports success and disables retries for that failure.

## Operational and security notes

- Redis stores payloads, job results and failure details. Do not enqueue secrets or raw access
  tokens; send identifiers and reload authorized data in the worker.
- Jobs are normally at-least-once. Use stable `jobId` values and application idempotency/outbox
  controls for external side effects.
- Bound payload size, concurrency and retention for your workload. The shipped retention counts are
  defaults, not capacity planning.
- Queue workers do not inherit HTTP `AsyncLocalStorage`. Put explicit tenant/user identifiers in a
  validated job payload and establish a trusted execution context in the worker.
- `QueueModule` is distinct from the PostgreSQL [job scheduler](./features/job-scheduler.md): BullMQ
  transports work; the scheduler coordinates one logical run across nodes.
