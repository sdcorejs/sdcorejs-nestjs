import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { JobScheduler } from './job-scheduler.entity';
import { type JobAcquireOptions, type JobAcquireResult, JobSchedulerStatus, JobSchedulerType } from './types';

/** Outcome of {@link JobSchedulerService.runExclusive}. */
export interface RunExclusiveResult<T> {
  /** True when this node won the lock and ran `fn`. */
  acquired: boolean;
  /** Return value of `fn` (only when `acquired`). */
  result?: T;
}

/**
 * Distributed cron lock. Across N scaled nodes firing the same scheduled job, only the node that
 * wins the atomic insert of the unique `lockKey` runs it — the rest skip. Replaces the racy
 * `existed()` + `begin()` check-then-insert from core-be (two nodes could both pass `existed`).
 */
@Injectable()
export class JobSchedulerService {
  private readonly logger = new Logger(JobSchedulerService.name);

  constructor(@InjectRepository(JobScheduler) private readonly repository: Repository<JobScheduler>) {}

  private lockKey(opts: JobAcquireOptions): string {
    return opts.runKey ? `${opts.code}:${opts.runKey}` : opts.code;
  }

  /**
   * Atomically claim the lock for a run. Returns `{ acquired: true, id }` for the single winner,
   * `{ acquired: false }` for every node that lost the race (or a prior run already took it).
   *
   * Uses `INSERT ... ON CONFLICT DO NOTHING RETURNING id` — the uniqueness of `lockKey` is the lock;
   * there is NO read-then-write window, so it is safe under concurrency across processes/nodes.
   */
  async acquire(opts: JobAcquireOptions): Promise<JobAcquireResult> {
    const result = await this.repository
      .createQueryBuilder()
      .insert()
      .into(JobScheduler)
      .values({
        lockKey: this.lockKey(opts),
        code: opts.code,
        name: opts.name,
        type: opts.type ?? JobSchedulerType.SCHEDULE,
        status: JobSchedulerStatus.RUNNING,
      })
      .orIgnore() // ON CONFLICT DO NOTHING
      .returning(['id'])
      .execute();

    const row = (result.raw as Array<{ id: string }> | undefined)?.[0];
    return row ? { acquired: true, id: row.id } : { acquired: false };
  }

  /** Mark a claimed run finished. */
  async complete(id: string, status: JobSchedulerStatus, data?: Record<string, unknown>): Promise<void> {
    // Cast: TypeORM's QueryDeepPartialEntity rejects a `jsonb` object-union prop directly.
    await this.repository.update(id, { status, data: data ?? null } as never);
  }

  /**
   * Run `fn` exactly once across the cluster for `{ code, runKey }`. The winner runs it and records
   * SUCCESS/FAIL; losers return `{ acquired: false }` without running. On `fn` error the run is
   * marked FAIL and the error is re-thrown.
   *
   * @example  // cron, every node calls this on the same tick:
   * await jobs.runExclusive({ code: 'sync-orders', runKey: tickIso, type: JobSchedulerType.SCHEDULE }, () => sync());
   */
  async runExclusive<T>(opts: JobAcquireOptions, fn: () => Promise<T>): Promise<RunExclusiveResult<T>> {
    const lock = await this.acquire(opts);
    if (!lock.acquired || !lock.id) return { acquired: false };
    try {
      const result = await fn();
      await this.complete(lock.id, JobSchedulerStatus.SUCCESS);
      return { acquired: true, result };
    } catch (err) {
      await this.complete(lock.id, JobSchedulerStatus.FAIL, { error: String(err) });
      this.logger.error(`Job '${opts.code}' failed: ${String(err)}`);
      throw err;
    }
  }
}
