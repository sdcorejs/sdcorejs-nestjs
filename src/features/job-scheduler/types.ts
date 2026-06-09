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
   * the next caller. Set this comfortably ABOVE the job's worst-case runtime — there is no
   * heartbeat, so a run that exceeds the lease can be picked up by another node. Default: 15 min.
   */
  leaseMs?: number;
}

/** Default {@link JobAcquireOptions.leaseMs} — a `RUNNING` lock older than this is reclaimable. */
export const DEFAULT_LEASE_MS = 15 * 60 * 1000;

export interface JobAcquireResult {
  /** True when THIS node won the lock and should run the job. */
  acquired: boolean;
  /** Job row id — present only when `acquired` is true; pass to {@link complete}. */
  id?: string;
}
