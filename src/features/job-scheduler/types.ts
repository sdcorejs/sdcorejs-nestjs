/** Lifecycle state of a scheduled job run. */
export enum JobSchedulerStatus {
  RUNNING = 'RUNNING',
  SUCCESS = 'SUCCESS',
  FAIL = 'FAIL',
}

export enum JobSchedulerType {
  /** Run-once across the whole cluster (e.g. seed/migration on boot). */
  INITIAL = 'INITIAL',
  /** Recurring cron — pass a per-tick `runKey` so each scheduled fire is its own lock. */
  SCHEDULE = 'SCHEDULE',
}

export interface JobAcquireOptions {
  /** Stable job identifier. */
  code: string;
  /**
   * Per-run discriminator. Forbidden for INITIAL (one canonical lock for `code`). Required for
   * SCHEDULE: pass the scheduled tick (e.g. an ISO timestamp truncated to the period) so each fire
   * is a distinct lock but concurrent nodes for the SAME tick collide and only one wins. Identity
   * inputs are trimmed and encoded into a versioned SHA-256 lock key.
   */
  runKey?: string;
  name?: string;
  type?: JobSchedulerType;
  /**
   * Lease window in ms. A `RUNNING` lock whose row has not been touched within this window is
   * assumed dead (the node that held it crashed before recording SUCCESS/FAIL) and is reclaimed by
   * the next caller. Must be a positive safe integer and more than twice `heartbeatMs` when the
   * heartbeat is enabled. Default: 15 min.
   */
  leaseMs?: number;
  /**
   * Heartbeat interval in ms. While the job runs, `runExclusive` periodically touches the lock row
   * (`modifiedAt` bump) so it stays within its lease — preventing a live-but-slow run from being
   * reclaimed by another node. Set below `leaseMs / 2`. By default it is the lower of 60 seconds
   * and one third of the effective lease, so a shortened lease never inherits an unsafe interval.
   *
   * Set to `0` to disable heartbeating (only safe for jobs guaranteed to finish well within `leaseMs`).
   */
  heartbeatMs?: number;
}

/** Default {@link JobAcquireOptions.leaseMs} — a `RUNNING` lock older than this is reclaimable. */
export const DEFAULT_LEASE_MS = 15 * 60 * 1000;

/** Maximum default heartbeat interval; shortened leases derive a lower one-third interval. */
export const DEFAULT_HEARTBEAT_MS = 60 * 1000;

/**
 * Discriminated result of an atomic job-lock acquisition. Checking `acquired` narrows the result:
 * winners always receive a complete fenced lease and stable idempotency key; losers receive none
 * of those fields.
 */
export type JobAcquireResult =
  | {
      /** True when THIS node won the lock and should run the job. */
      acquired: true;
      /** Job row id. Pair it with `ownerToken` as a lease. */
      id: string;
      /**
       * Unpredictable lease owner token. Every heartbeat/finalization call must present this token;
       * reclaiming a stale job rotates it so the previous worker is fenced out.
       */
      ownerToken: string;
      /**
       * Stable identifier for this logical `{ type, code, runKey }` execution. It remains unchanged
       * when a stale lease is reclaimed, so consumers can use it as an idempotency/outbox key for
       * external side effects.
       */
      idempotencyKey: string;
    }
  | {
      /** False when another node owns or already completed this logical run. */
      acquired: false;
      id?: never;
      ownerToken?: never;
      idempotencyKey?: never;
    };

/** Capability proving ownership of the current RUNNING lease for a job row. */
export interface JobLease {
  id: string;
  ownerToken: string;
}

/** Lease passed to `runExclusive`, including the stable logical-run idempotency key. */
export interface JobExecutionLease extends JobLease {
  idempotencyKey: string;
}

/** Raised by `runExclusive` when its lease was reclaimed before it could finalize. */
export class LostJobLeaseError extends Error {
  constructor(readonly jobId: string) {
    super(`Job lease '${jobId}' is no longer owned by this worker`);
    this.name = 'LostJobLeaseError';
  }
}

/** Raised before acquisition when lease/heartbeat timing cannot safely fence a live worker. */
export class InvalidJobLeaseOptionsError extends Error {
  constructor(reason: string) {
    super(`Invalid job lease options: ${reason}`);
    this.name = 'InvalidJobLeaseOptionsError';
  }
}

/** Raised before acquisition when code/type/runKey cannot identify one unambiguous logical run. */
export class InvalidJobIdentityOptionsError extends Error {
  constructor(reason: string) {
    super(`Invalid job identity options: ${reason}`);
    this.name = 'InvalidJobIdentityOptionsError';
  }
}
