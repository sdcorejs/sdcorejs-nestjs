import { type DynamicModule, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { DEFAULT_JOB_OPTIONS, DEFAULT_QUEUE_PREFIX, type QueueModuleConfig } from './types';

/**
 * Thin wrapper over `@nestjs/bullmq` that wires a single shared Redis connection and consistent
 * defaults for the whole app. Two-step usage, mirroring `@nestjs/bullmq`:
 *
 * 1. **Once, at the root** — open the connection:
 *
 *    ```ts
 *    @Module({
 *      imports: [
 *        QueueModule.forRoot({ connection: { host: 'localhost', port: 6379, db: 1 } }),
 *      ],
 *    })
 *    export class AppModule {}
 *    ```
 *
 * 2. **Per feature module** — declare the queues that module produces to / consumes from:
 *
 *    ```ts
 *    @Module({
 *      imports: [QueueModule.registerQueue('emails', 'reports')],
 *      providers: [EmailsProcessor],   // a worker — see SdWorkerHost
 *    })
 *    export class EmailsModule {}
 *    ```
 *
 * Then **produce** jobs by injecting the queue, and **consume** them with a worker:
 *
 *    ```ts
 *    // producer
 *    constructor(@InjectQueue('emails') private emails: Queue) {}
 *    await this.emails.add('welcome', { userId }, { delay: 5000 }); // run 5s later
 *
 *    // consumer (worker)
 *    @Processor('emails')
 *    export class EmailsProcessor extends SdWorkerHost<{ userId: string }> {
 *      async handle(job) { await sendWelcome(job.data.userId); }
 *    }
 *    ```
 */
@Module({})
export class QueueModule {
  /**
   * Open the shared Redis connection for BullMQ. Call ONCE (root module). `global: true` makes the
   * connection injectable everywhere, so feature modules only need `registerQueue`.
   */
  static forRoot(config: QueueModuleConfig): DynamicModule {
    const bull = BullModule.forRoot({
      // `connection` is passed straight to ioredis (BullMQ's Redis client).
      connection: config.connection,
      prefix: config.prefix ?? DEFAULT_QUEUE_PREFIX,
      // Root-level default job options; per-queue defaults below merge on top.
      defaultJobOptions: { ...DEFAULT_JOB_OPTIONS, ...config.defaultJobOptions },
    });

    return {
      module: QueueModule,
      global: true,
      imports: [bull],
      exports: [bull],
    };
  }

  /**
   * Register one or more queues by name for the importing module. Each becomes injectable via
   * `@InjectQueue(name)` and targetable by a `@Processor(name)` worker. Re-import in every module
   * that touches the queue (BullMQ de-dupes the underlying queue by name).
   */
  static registerQueue(...names: string[]): DynamicModule {
    // No per-queue `defaultJobOptions` here: queue-level options would SHADOW the (already
    // merged) root-level `defaultJobOptions` set in `forRoot`. Let the root defaults apply.
    const reg = BullModule.registerQueue(...names.map((name) => ({ name })));
    return {
      module: QueueModule,
      imports: [reg],
      exports: [reg],
    };
  }
}
