# BullMQ queue

The queue layer wraps `@nestjs/bullmq` with one Redis connection, consistent defaults, public
decorator/type re-exports, and a worker base class that preserves retry behavior.

## Open the connection once

```ts
import { Module } from '@nestjs/common';
import { QueueModule } from '@sdcorejs/nestjs/queue';

@Module({
  imports: [
    QueueModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST ?? 'localhost',
        port: Number(process.env.REDIS_PORT ?? 6379),
        db: 1,
      },
      prefix: 'orders:prod:queue',
    }),
  ],
})
export class AppModule {}
```

You can instead set `queue: { connection, prefix, defaultJobOptions }` in
`SdCoreModule.forRoot()`. Use one root approach, not both. Keep queues in a separate Redis database
or prefix from cache data.

## Register and produce

```ts
import { Injectable, Module } from '@nestjs/common';
import {
  InjectQueue,
  QueueModule,
  type Queue,
} from '@sdcorejs/nestjs/queue';

interface EmailJob {
  userId: string;
  template: 'welcome' | 'receipt';
}

@Injectable()
class EmailProducer {
  constructor(@InjectQueue('emails') private readonly queue: Queue<EmailJob>) {}

  enqueue(payload: EmailJob) {
    return this.queue.add('send', payload, {
      jobId: `email-${payload.template}-${payload.userId}`,
    });
  }
}

@Module({
  imports: [QueueModule.registerQueue('emails')],
  providers: [EmailProducer],
  exports: [EmailProducer],
})
export class EmailQueueModule {}
```

`jobId` is an application deduplication choice. Select an identity matching your business
semantics; omitting it allows repeated jobs. BullMQ rejects custom IDs containing `:`, so use a safe
delimiter or a stable hash.

## Consume and retry

```ts
import { Injectable } from '@nestjs/common';
import {
  OnWorkerEvent,
  Processor,
  SdWorkerHost,
  type Job,
} from '@sdcorejs/nestjs/queue';

@Injectable()
class Mailer {
  async send(_userId: string, _template: string): Promise<void> {}
}

@Processor('emails', { concurrency: 5 })
class EmailWorker extends SdWorkerHost<EmailJob, void> {
  constructor(private readonly mailer: Mailer) {
    super();
  }

  async handle(job: Job<EmailJob>): Promise<void> {
    await this.mailer.send(job.data.userId, job.data.template);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<EmailJob> | undefined, error: Error): void {
    this.logger.warn('email attempt failed: ' + (job?.id ?? 'unknown') + ': ' + error.message);
  }
}
```

Register `EmailWorker` and `Mailer` as providers in a module that imports
`QueueModule.registerQueue('emails')`. Throw from `handle()` to fail an attempt.
`SdWorkerHost.process()` rethrows so BullMQ applies retries; swallowing an error marks success.

## Defaults

`DEFAULT_JOB_OPTIONS` supplies 3 attempts, exponential backoff starting at 1 second, the latest
1,000 completed jobs, and the latest 5,000 failed jobs. Override at the root or per `queue.add()`.
Keep retention bounded to prevent unbounded Redis growth.

## Queue versus job scheduler

| Need | Use |
| --- | --- |
| durable payload, retries, delay, worker pool | BullMQ queue |
| one winner for the same cron tick across API instances | job scheduler |
| both | scheduler callback enqueues one idempotently identified BullMQ job |

Neither primitive makes arbitrary external effects exactly-once. Use business-level idempotency at
the effect boundary.

## Operations

- Monitor waiting, active, delayed, failed, and stalled jobs.
- Configure Redis persistence/availability for the required durability.
- Make handlers idempotent because retries can repeat work.
- Set concurrency according to downstream limits, not only CPU.
- Alert on exhausted retries and growing lag.
- Use separate workers/processes when long jobs should not share API resources.
