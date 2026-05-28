# `@sdcorejs/nestjs/queue` — BullMQ + Redis jobs

A thin, documented wrapper over [`@nestjs/bullmq`](https://docs.nestjs.com/techniques/queues) for
background jobs backed by Redis.

## Concepts (1 minute)

- **Queue** — a named list of jobs in Redis (e.g. `emails`).
- **Job** — a named payload added to a queue (`add('welcome', { userId })`).
- **Producer** — code that adds jobs (`@InjectQueue('emails')`).
- **Worker / processor** — a long-lived consumer that pulls jobs and runs them (`@Processor('emails')`).
- **Why Redis** — job state lives in Redis, so jobs survive restarts, run out-of-process, and scale
  across many worker instances (they load-balance automatically by queue name).
- **Retries / backoff** — a job that throws is retried per the queue's `attempts` + `backoff`.
- **Delayed / repeatable** — jobs can run later (`{ delay }`) or on a cron (`{ repeat: { pattern } }`).

## Install (optional peers)

```bash
npm i @nestjs/bullmq bullmq
```

(Only needed when you use this subpath. Requires a reachable Redis.)

## Setup

```ts
// app.module.ts — open the connection ONCE
import { QueueModule } from '@sdcorejs/nestjs/queue';

@Module({
  imports: [
    QueueModule.forRoot({
      connection: { host: 'localhost', port: 6379, db: 1 }, // keep queues on a separate db
      prefix: 'myapp:queue',
    }),
  ],
})
export class AppModule {}
```

```ts
// emails.module.ts — declare the queue + register its worker
import { QueueModule } from '@sdcorejs/nestjs/queue';

@Module({
  imports: [QueueModule.registerQueue('emails')],
  providers: [EmailsProcessor, EmailsService],
})
export class EmailsModule {}
```

## Produce jobs

```ts
import { InjectQueue, type Queue } from '@sdcorejs/nestjs/queue';

@Injectable()
export class EmailsService {
  constructor(@InjectQueue('emails') private readonly emails: Queue) {}

  async sendWelcome(userId: string) {
    await this.emails.add('welcome', { userId });                 // ASAP
    await this.emails.add('digest', { userId }, { delay: 60_000 }); // in 60s
  }

  async scheduleDailyReport() {
    await this.emails.add('daily', {}, { repeat: { pattern: '0 8 * * *' } }); // 08:00 daily
  }
}
```

## Consume jobs (worker)

```ts
import { Processor, OnWorkerEvent, SdWorkerHost, type Job } from '@sdcorejs/nestjs/queue';

@Processor('emails', { concurrency: 5 }) // up to 5 jobs in parallel in this instance
export class EmailsProcessor extends SdWorkerHost<{ userId: string }> {
  constructor(private readonly mailer: Mailer) { super(); }

  // Throw to fail the attempt → BullMQ retries with backoff (attempts: 3 by default).
  async handle(job: Job<{ userId: string }>) {
    if (job.name === 'welcome') await this.mailer.sendWelcome(job.data.userId);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error) {
    // Fired on EACH failed attempt; after the last attempt the job lands in the "failed" set.
  }
}
```

## Defaults (`DEFAULT_JOB_OPTIONS`)

Every registered queue gets: `attempts: 3`, exponential `backoff` (1s→2s→4s),
`removeOnComplete: 1000`, `removeOnFail: 5000`. Override per `add()` call or via
`QueueModule.forRoot({ defaultJobOptions })`.
