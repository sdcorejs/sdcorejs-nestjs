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
}

export interface JobAcquireResult {
  /** True when THIS node won the lock and should run the job. */
  acquired: boolean;
  /** Job row id — present only when `acquired` is true; pass to {@link complete}. */
  id?: string;
}
