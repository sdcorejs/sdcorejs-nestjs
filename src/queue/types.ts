import type { JobsOptions } from 'bullmq';

/**
 * Redis connection for BullMQ. Mirrors the cache module's `RedisCacheOptions` shape on purpose,
 * so a project configures its Redis the same way for cache and queues. Any extra ioredis option
 * (sentinels, tls, family, …) passes through via the index signature.
 *
 * BullMQ keeps ALL queue state in Redis — jobs, their status, retries, scheduled/delayed jobs —
 * so this connection must point at a Redis the workers can also reach. Use a dedicated Redis db
 * (or `prefix`) to avoid key collisions with the cache.
 */
export interface QueueConnectionConfig {
  host?: string;
  port?: number;
  password?: string;
  username?: string;
  /** Redis logical DB index. Tip: keep queues on a different `db` than the cache. */
  db?: number;
  tls?: Record<string, unknown>;
  /** Pass-through for any other ioredis option. */
  [key: string]: unknown;
}

export interface QueueModuleConfig {
  /** Redis connection shared by every queue + worker registered through this module. */
  connection: QueueConnectionConfig;
  /**
   * Key prefix BullMQ uses in Redis (namespaces all queue keys). Default: `'sdcore:queue'`.
   * Changing this isolates environments/apps that share one Redis instance.
   */
  prefix?: string;
  /**
   * Default options applied to every job of every queue registered via `registerQueue` — unless a
   * queue or an individual `add()` call overrides them. See `DEFAULT_JOB_OPTIONS` for the rationale
   * behind the shipped defaults (retries + exponential backoff + auto-cleanup).
   */
  defaultJobOptions?: JobsOptions;
}

/**
 * Sensible production defaults for jobs:
 * - `attempts: 3`            — retry a failing job up to 3 times before it lands in "failed".
 * - `backoff: exponential`   — wait 1s, then 2s, then 4s between attempts (avoids hammering a
 *                              flaky downstream). BullMQ computes `delay * 2^(attempt-1)`.
 * - `removeOnComplete: 1000` — keep only the last 1000 completed jobs (else Redis grows forever).
 * - `removeOnFail: 5000`     — keep more failed jobs around for debugging, but still bounded.
 */
export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 1000 },
  removeOnComplete: 1000,
  removeOnFail: 5000,
};

/** Default Redis key prefix for all queues registered through `QueueModule`. */
export const DEFAULT_QUEUE_PREFIX = 'sdcore:queue';
