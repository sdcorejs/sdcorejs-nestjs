import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomUUID } from 'node:crypto';
import type { Repository } from 'typeorm';
import { JobScheduler } from './job-scheduler.entity';
import {
  DEFAULT_HEARTBEAT_MS,
  DEFAULT_LEASE_MS,
  type JobAcquireOptions,
  type JobAcquireResult,
  type JobExecutionLease,
  type JobLease,
  InvalidJobIdentityOptionsError,
  InvalidJobLeaseOptionsError,
  JobSchedulerStatus,
  JobSchedulerType,
  LostJobLeaseError,
} from './types';

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

  private resolveIdentity(opts: JobAcquireOptions): { code: string; lockKey: string; type: JobSchedulerType } {
    const rawCode: unknown = opts?.code;
    const rawRunKey: unknown = opts?.runKey;
    const rawType: unknown = opts?.type;
    const code = typeof rawCode === 'string' ? rawCode.trim() : '';
    const runKey = typeof rawRunKey === 'string' ? rawRunKey.trim() : undefined;
    const type = rawType === undefined ? JobSchedulerType.SCHEDULE : rawType;
    if (!code || code.length > 64) throw new InvalidJobIdentityOptionsError('code must contain 1 to 64 non-whitespace characters');
    if (type !== JobSchedulerType.SCHEDULE && type !== JobSchedulerType.INITIAL) {
      throw new InvalidJobIdentityOptionsError('type must be INITIAL or SCHEDULE');
    }
    if (type === JobSchedulerType.SCHEDULE && (typeof rawRunKey !== 'string' || !runKey || runKey.length > 1024)) {
      throw new InvalidJobIdentityOptionsError('SCHEDULE jobs require a non-empty runKey no longer than 1024 characters');
    }
    if (type === JobSchedulerType.INITIAL && rawRunKey !== undefined) {
      throw new InvalidJobIdentityOptionsError('INITIAL jobs must not define runKey');
    }
    const identity = JSON.stringify({ version: 2, type, code, runKey: type === JobSchedulerType.SCHEDULE ? runKey : null });
    return {
      code,
      lockKey: `v2:${createHash('sha256').update(identity).digest('base64url')}`,
      type,
    };
  }

  private resolveLeaseTiming(opts: JobAcquireOptions): { heartbeatMs: number; leaseMs: number } {
    const rawLeaseMs: unknown = opts?.leaseMs;
    const leaseMs = rawLeaseMs === undefined ? DEFAULT_LEASE_MS : rawLeaseMs;
    if (typeof leaseMs !== 'number' || !Number.isSafeInteger(leaseMs) || leaseMs <= 2) {
      throw new InvalidJobLeaseOptionsError('leaseMs must be a safe integer greater than 2');
    }

    const rawHeartbeatMs: unknown = opts?.heartbeatMs;
    const heartbeatMs =
      rawHeartbeatMs === undefined ? Math.min(DEFAULT_HEARTBEAT_MS, Math.max(1, Math.floor(leaseMs / 3))) : rawHeartbeatMs;
    if (typeof heartbeatMs !== 'number' || !Number.isSafeInteger(heartbeatMs) || heartbeatMs < 0) {
      throw new InvalidJobLeaseOptionsError('heartbeatMs must be a non-negative safe integer');
    }
    if (heartbeatMs > 0 && heartbeatMs * 2 >= leaseMs) {
      throw new InvalidJobLeaseOptionsError('heartbeatMs must be less than half of leaseMs');
    }
    return { heartbeatMs, leaseMs };
  }

  /**
   * Atomically claim the lock for a run. Returns
   * `{ acquired: true, id, ownerToken, idempotencyKey }` for the winner and `{ acquired: false }`
   * for every node that lost the race. `idempotencyKey` is stable across lease reclamation for the
   * same logical run and is suitable for consumer-side outbox/deduplication records.
   *
   * Two-step claim:
   *  1. `INSERT ... ON CONFLICT DO NOTHING RETURNING id` — wins if no row exists for `lockKey`.
   *  2. On conflict, re-claim only a previous `FAIL` or a `RUNNING` lease that expired according to
   *     the database clock. A `SUCCESS` run stays locked (run-once semantics for INITIAL jobs), and
   *     a live `RUNNING` row is left to its current owner.
   *
   * This lets a transient failure (e.g. a dependency not ready at boot) be retried on the next call
   * instead of being permanently locked, while keeping single-winner safety: the insert is atomic,
   * and only one node can match-and-return the conditional update for a given FAIL row.
   */
  async acquire(opts: JobAcquireOptions): Promise<JobAcquireResult> {
    const { leaseMs } = this.resolveLeaseTiming(opts);
    const { code, lockKey, type } = this.resolveIdentity(opts);
    const ownerToken = randomUUID();

    // 1. Try to claim fresh (keeps TypeORM's generated id + audit columns).
    const inserted = await this.repository
      .createQueryBuilder()
      .insert()
      .into(JobScheduler)
      .values({
        lockKey,
        code,
        name: opts.name,
        type,
        status: JobSchedulerStatus.RUNNING,
        ownerToken,
      })
      .orIgnore() // ON CONFLICT DO NOTHING
      .returning(['id'])
      .execute();

    const insertedRow = (inserted.raw as Array<{ id: string }> | undefined)?.[0];
    if (insertedRow) return { acquired: true, id: insertedRow.id, ownerToken, idempotencyKey: lockKey };

    // 2. Conflict: re-claim a previously FAILED run, OR a RUNNING run whose lease has expired (the
    //    node that held it crashed before recording SUCCESS/FAIL). A SUCCESS row stays locked
    //    (run-once), and a RUNNING row within its lease is left to its owner. The conditional UPDATE
    //    is atomic, so only one node can match-and-return a given reclaimable row.
    const reclaimed = await this.repository
      .createQueryBuilder()
      .update(JobScheduler)
      .set({ status: JobSchedulerStatus.RUNNING, data: null, ownerToken, modifiedAt: () => 'CURRENT_TIMESTAMP' } as never)
      .where(
        '"lockKey" = :lockKey AND (status = :failed OR (status = :running AND "modifiedAt" < CURRENT_TIMESTAMP - CAST(:leaseInterval AS interval)))',
        {
          lockKey,
          failed: JobSchedulerStatus.FAIL,
          running: JobSchedulerStatus.RUNNING,
          leaseInterval: `${leaseMs} milliseconds`,
        },
      )
      .returning(['id'])
      .execute();

    const reclaimedRow = (reclaimed.raw as Array<{ id: string }> | undefined)?.[0];
    return reclaimedRow ? { acquired: true, id: reclaimedRow.id, ownerToken, idempotencyKey: lockKey } : { acquired: false };
  }

  /** Refresh a RUNNING lease only while `lease.ownerToken` still owns it. */
  async heartbeat(lease: JobLease): Promise<boolean> {
    return this.mutateOwnedLease(lease, { modifiedAt: () => 'CURRENT_TIMESTAMP' });
  }

  /** Mark the currently-owned RUNNING lease successful. Returns false after ownership is lost. */
  async complete(lease: JobLease, data?: Record<string, unknown>): Promise<boolean> {
    return this.mutateOwnedLease(lease, { status: JobSchedulerStatus.SUCCESS, data: data ?? null });
  }

  /** Mark the currently-owned RUNNING lease failed. Returns false after ownership is lost. */
  async fail(lease: JobLease, data?: Record<string, unknown>): Promise<boolean> {
    return this.mutateOwnedLease(lease, { status: JobSchedulerStatus.FAIL, data: data ?? null });
  }

  /**
   * Release the currently-owned lease for retry. A released row becomes `FAIL`, which the next
   * atomic `acquire` may reclaim with a fresh owner token.
   */
  async release(lease: JobLease, data: Record<string, unknown> = { released: true }): Promise<boolean> {
    return this.fail(lease, data);
  }

  private async mutateOwnedLease(lease: JobLease, set: Record<string, unknown>): Promise<boolean> {
    const result = await this.repository
      .createQueryBuilder()
      .update(JobScheduler)
      .set(set as never)
      .where('id = :id AND "ownerToken" = :ownerToken AND status = :running', {
        id: lease.id,
        ownerToken: lease.ownerToken,
        running: JobSchedulerStatus.RUNNING,
      })
      .execute();
    return result.affected === 1;
  }

  /**
   * Run `fn` under a fenced cluster lease for `{ code, runKey }`. The winner receives a
   * {@link JobExecutionLease}, including a stable `idempotencyKey`; losers return
   * `{ acquired: false }` without running. Database finalization is single-owner, but external side
   * effects must still use that key with an outbox or equivalent business-level deduplication
   * because a worker may lose its lease after performing an effect.
   *
   * @example  // cron, every node calls this on the same tick:
   * await jobs.runExclusive(
   *   { code: 'sync-orders', runKey: tickIso, type: JobSchedulerType.SCHEDULE },
   *   ({ idempotencyKey }) => sync({ idempotencyKey }),
   * );
   */
  async runExclusive<T>(opts: JobAcquireOptions, fn: (lease: JobExecutionLease) => Promise<T>): Promise<RunExclusiveResult<T>> {
    const timing = this.resolveLeaseTiming(opts);
    const lock = await this.acquire({ ...opts, ...timing });
    if (!lock.acquired) return { acquired: false };
    const lease: JobExecutionLease = { id: lock.id, ownerToken: lock.ownerToken, idempotencyKey: lock.idempotencyKey };

    // Heartbeat: touch modifiedAt periodically so the lock stays within its lease window.
    // Prevents a live-but-slow run from being reclaimed by another node.
    const heartbeatMs = timing.heartbeatMs;
    const heartbeat =
      heartbeatMs > 0
        ? setInterval(() => {
            void this.heartbeat(lease)
              .then((owned) => {
                if (!owned) this.logger.warn(`Job '${opts.code}' heartbeat rejected: lease ownership was lost`);
              })
              .catch((e: Error) => this.logger.warn(`Job '${opts.code}' heartbeat failed: ${e.message}`));
          }, heartbeatMs)
        : null;

    try {
      const result = await fn(lease);
      if (!(await this.complete(lease))) throw new LostJobLeaseError(lease.id);
      return { acquired: true, result };
    } catch (err) {
      if (!(err instanceof LostJobLeaseError)) {
        const failed = await this.fail(lease, { error: String(err) });
        if (!failed) this.logger.warn(`Job '${opts.code}' failure was not recorded: lease ownership was lost`);
      }
      this.logger.error(`Job '${opts.code}' failed: ${String(err)}`);
      throw err;
    } finally {
      if (heartbeat) clearInterval(heartbeat);
    }
  }
}
