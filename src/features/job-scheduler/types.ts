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
   * Per-run discriminator. Omit for INITIAL (lock key = `code`, one row ever). For SCHEDULE pass the
   * scheduled tick (e.g. an ISO timestamp truncated to the period) so each fire is a distinct lock
   * but concurrent nodes for the SAME tick collide and only one wins.
   */
  runKey?: string;
  name?: string;
  type?: JobSchedulerType;
  /**
   * Lease window in ms. A `RUNNING` lock whose row has not been touched within this window is
   * assumed dead (the node that held it crashed before recording SUCCESS/FAIL) and is reclaimed by
   * the next caller. Should be set above `heartbeatMs` × 2 at minimum. Default: 15 min.
   */
  leaseMs?: number;
  /**
   * Heartbeat interval in ms. While the job runs, `runExclusive` periodically touches the lock row
   * (`modifiedAt` bump) so it stays within its lease — preventing a live-but-slow run from being
   * reclaimed by another node. Set below `leaseMs / 2`. Default: 60 s.
   *
   * Set to `0` to disable heartbeating (only safe for jobs guaranteed to finish well within `leaseMs`).
   */
  heartbeatMs?: number;
}

/** Default {@link JobAcquireOptions.leaseMs} — a `RUNNING` lock older than this is reclaimable. */
export const DEFAULT_LEASE_MS = 15 * 60 * 1000;

/** Default {@link JobAcquireOptions.heartbeatMs} — touch the lock row this often while the job runs. */
export const DEFAULT_HEARTBEAT_MS = 60 * 1000;

export interface JobAcquireResult {
  /** True when THIS node won the lock and should run the job. */
  acquired: boolean;
  /** Job row id — present only when `acquired` is true; pass to {@link complete}. */
  id?: string;
}
