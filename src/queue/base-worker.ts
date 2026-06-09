import { Logger } from '@nestjs/common';
import { WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';

/**
 * Base class for BullMQ workers (consumers). Subclass it, decorate with `@Processor('<queue>')`,
 * and implement `handle()`. The class wraps `@nestjs/bullmq`'s `WorkerHost` to add:
 *
 * - **structured logging** of start / success / failure (with attempt number), and
 * - the correct **retry contract**: any error thrown from `handle()` is logged and re-thrown so
 *   BullMQ marks the attempt failed and applies the queue's `attempts` + `backoff` policy. If you
 *   swallow the error, BullMQ thinks the job succeeded and will NOT retry.
 *
 * A "worker" is a long-lived consumer that pulls jobs from Redis and runs them. Multiple instances
 * (or processes) sharing the same queue name load-balance automatically. Control parallelism per
 * worker with the `concurrency` option on `@Processor('q', { concurrency: 5 })`.
 *
 * @example
 * @Processor('emails', { concurrency: 5 })
 * export class EmailsProcessor extends SdWorkerHost<{ userId: string }> {
 *   constructor(private mailer: Mailer) { super(); }
 *   async handle(job: Job<{ userId: string }>) {
 *     await this.mailer.sendWelcome(job.data.userId);   // throw on failure → auto-retry
 *   }
 * }
 */
export abstract class SdWorkerHost<TData = unknown, TResult = unknown> extends WorkerHost {
  protected readonly logger = new Logger(this.constructor.name);

  /**
   * BullMQ entry point — do not override. Delegates to `handle()` and enforces the logging +
   * re-throw (retry) contract. Override `handle()` instead.
   */
  async process(job: Job<TData, TResult>): Promise<TResult> {
    const attempt = job.attemptsMade + 1;
    this.logger.debug(`▶ ${job.queueName}:${job.name}#${job.id} (attempt ${attempt})`);
    try {
      const result = await this.handle(job);
      this.logger.debug(`✓ ${job.queueName}:${job.name}#${job.id}`);
      return result;
    } catch (err) {
      // Re-throw so BullMQ records the failure and applies attempts/backoff. Final failure (after
      // all attempts) moves the job to the "failed" set, retained per `removeOnFail`.
      this.logger.error(`✗ ${job.queueName}:${job.name}#${job.id} (attempt ${attempt}): ${(err as Error).message}`);
      throw err;
    }
  }

  /** Implement the job's work here. Throw to signal failure → BullMQ retries with backoff. */
  abstract handle(job: Job<TData, TResult>): Promise<TResult>;
}
