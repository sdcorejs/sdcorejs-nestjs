import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { JobScheduler } from './job-scheduler.entity';
import { DEFAULT_HEARTBEAT_MS, DEFAULT_LEASE_MS, type JobAcquireOptions, type JobAcquireResult, JobSchedulerStatus, JobSchedulerType } from './types';

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
   * `{ acquired: false }` for every node that lost the race.
   *
   * Two-step claim:
   *  1. `INSERT ... ON CONFLICT DO NOTHING RETURNING id` — wins if no row exists for `lockKey`.
   *  2. On conflict, **re-claim only if the previous run FAILED**: a conditional
   *     `UPDATE ... SET status=RUNNING WHERE status=FAIL RETURNING id`. A `SUCCESS` run stays locked
   *     (run-once semantics for INITIAL jobs), and a `RUNNING` row is left alone (another node owns it).
   *
   * This lets a transient failure (e.g. a dependency not ready at boot) be retried on the next call
   * instead of being permanently locked, while keeping single-winner safety: the insert is atomic,
   * and only one node can match-and-return the conditional update for a given FAIL row.
   */
  async acquire(opts: JobAcquireOptions): Promise<JobAcquireResult> {
    const lockKey = this.lockKey(opts);

    // 1. Try to claim fresh (keeps TypeORM's generated id + audit columns).
    const inserted = await this.repository
      .createQueryBuilder()
      .insert()
      .into(JobScheduler)
      .values({
        lockKey,
        code: opts.code,
        name: opts.name,
        type: opts.type ?? JobSchedulerType.SCHEDULE,
        status: JobSchedulerStatus.RUNNING,
      })
      .orIgnore() // ON CONFLICT DO NOTHING
      .returning(['id'])
      .execute();

    const insertedRow = (inserted.raw as Array<{ id: string }> | undefined)?.[0];
    if (insertedRow) return { acquired: true, id: insertedRow.id };

    // 2. Conflict: re-claim a previously FAILED run, OR a RUNNING run whose lease has expired (the
    //    node that held it crashed before recording SUCCESS/FAIL). A SUCCESS row stays locked
    //    (run-once), and a RUNNING row within its lease is left to its owner. The conditional UPDATE
    //    is atomic, so only one node can match-and-return a given reclaimable row.
    const staleBefore = new Date(Date.now() - (opts.leaseMs ?? DEFAULT_LEASE_MS));
    const reclaimed = await this.repository
      .createQueryBuilder()
      .update(JobScheduler)
      .set({ status: JobSchedulerStatus.RUNNING, data: null } as never)
      .where('"lockKey" = :lockKey AND (status = :failed OR (status = :running AND "modifiedAt" < :staleBefore))', {
        lockKey,
        failed: JobSchedulerStatus.FAIL,
        running: JobSchedulerStatus.RUNNING,
        staleBefore,
      })
      .returning(['id'])
      .execute();

    const reclaimedRow = (reclaimed.raw as Array<{ id: string }> | undefined)?.[0];
    return reclaimedRow ? { acquired: true, id: reclaimedRow.id } : { acquired: false };
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

    // Heartbeat: touch modifiedAt periodically so the lock stays within its lease window.
    // Prevents a live-but-slow run from being reclaimed by another node.
    const heartbeatMs = opts.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
    const heartbeat =
      heartbeatMs > 0
        ? setInterval(() => {
            void this.repository.update(lock.id!, { modifiedAt: new Date() } as never).catch((e: Error) => {
              this.logger.warn(`Job '${opts.code}' heartbeat failed: ${e.message}`);
            });
          }, heartbeatMs)
        : null;

    try {
      const result = await fn();
      await this.complete(lock.id, JobSchedulerStatus.SUCCESS);
      return { acquired: true, result };
    } catch (err) {
      await this.complete(lock.id, JobSchedulerStatus.FAIL, { error: String(err) });
      this.logger.error(`Job '${opts.code}' failed: ${String(err)}`);
      throw err;
    } finally {
      if (heartbeat) clearInterval(heartbeat);
    }
  }
}
