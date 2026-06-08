# Background jobs (BullMQ)

`@sdcorejs/nestjs/queue` is a thin wrapper over `@nestjs/bullmq` that wires one shared Redis connection
and production-ready job defaults for the whole app. You import every queue primitive from this one
entry — `QueueModule`, `SdWorkerHost`, plus the re-exported `Processor`, `InjectQueue`, `OnWorkerEvent`
and the `Job` / `Queue` types — instead of reaching into `@nestjs/bullmq` + `bullmq` directly.

> `bullmq` + `@nestjs/bullmq` ship as bundled dependencies — nothing extra to install. BullMQ keeps all
> job state in Redis, so point `connection` at a Redis your workers can also reach (a dedicated `db` or
> `prefix` keeps it off your cache keys).

## 1. Open the connection (once)

`SdCoreModule` wires the connection for you when the `queue` key is present:

```ts
SdCoreModule.forRoot({
  // ...
  queue: { connection: { host: 'localhost', port: 6379, db: 1 } },
});
```

Equivalent standalone form if you don't use `SdCoreModule`:

```ts
@Module({
  imports: [QueueModule.forRoot({ connection: { host: 'localhost', port: 6379, db: 1 } })],
})
export class AppModule {}
```

`forRoot` is `global: true`, so feature modules only need `registerQueue`. Shipped job defaults
(`DEFAULT_JOB_OPTIONS`): `attempts: 3`, exponential `backoff` (1s → 2s → 4s), `removeOnComplete: 1000`,
`removeOnFail: 5000`. Override per-app via `defaultJobOptions`, or per-call on `add()`.

## 2. Register queues per module

Declare the queues a module produces to / consumes from. Re-import in every module that touches the
queue (BullMQ de-dupes by name):

```ts
import { QueueModule } from '@sdcorejs/nestjs/queue';

@Module({
  imports: [QueueModule.registerQueue('emails', 'reports')],
  providers: [EmailsProcessor], // the worker, see step 4
})
export class EmailsModule {}
```

## 3. Produce jobs

Inject the queue and `add(name, data, opts?)`:

```ts
import { Injectable } from '@nestjs/common';
import { InjectQueue, type Queue } from '@sdcorejs/nestjs/queue';

@Injectable()
export class EmailsService {
  constructor(@InjectQueue('emails') private readonly emails: Queue) {}

  async welcome(userId: string) {
    await this.emails.add('welcome', { userId }, { delay: 5000 }); // run 5s later
  }
}
```

## 4. Consume jobs — `SdWorkerHost`

Subclass `SdWorkerHost`, decorate with `@Processor('<queue>')`, implement `handle()`. The base class
adds structured start/success/failure logging and enforces the **retry contract**:

```ts
import { Processor, SdWorkerHost, type Job } from '@sdcorejs/nestjs/queue';

@Processor('emails', { concurrency: 5 })
export class EmailsProcessor extends SdWorkerHost<{ userId: string }> {
  constructor(private readonly mailer: Mailer) {
    super();
  }

  async handle(job: Job<{ userId: string }>) {
    await this.mailer.sendWelcome(job.data.userId); // throw on failure → BullMQ retries with backoff
  }
}
```

::: warning Always throw on failure
Don't override `process()` and don't swallow errors. `SdWorkerHost.process()` re-throws whatever
`handle()` throws so BullMQ records the failed attempt and applies the queue's `attempts` + `backoff`.
If you catch and return normally, BullMQ thinks the job succeeded and will **not** retry.
:::

A worker is a long-lived consumer. Run multiple instances/processes on the same queue name and they
load-balance automatically; cap per-worker parallelism with `@Processor('q', { concurrency: N })`.

## Worker events (optional)

```ts
import { Processor, SdWorkerHost, OnWorkerEvent, type Job } from '@sdcorejs/nestjs/queue';

@Processor('emails')
export class EmailsProcessor extends SdWorkerHost<{ userId: string }> {
  async handle(job: Job<{ userId: string }>) {
    /* ... */
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error) {
    this.logger.error(`final failure ${job.id}: ${err.message}`);
  }
}
```

::: tip Queue vs. JobScheduler
Use the **queue** for fan-out work items (emails, reports, webhooks) — many jobs, retried, load-balanced
across workers. Use [`JobScheduler.runExclusive`](/guide/features#job-scheduler-distributed-cron-lock)
when N nodes fire the **same** scheduled task and you need exactly one to run it.
:::
