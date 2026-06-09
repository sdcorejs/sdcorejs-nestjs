export type CacheBackendKind = 'memory' | 'redis';

export interface CacheConfig {
  /** Backend driver. Default: `'memory'` (in-process LRU). */
  backend?: CacheBackendKind;
  /** Default TTL in seconds. `0` disables expiry. Default: 60. */
  ttl?: number;
  /** Max entries — memory backend only. Default: 1000. */
  maxEntries?: number;
  /** Connection + key-prefix options for the redis backend. */
  redis?: RedisCacheOptions;
  /**
   * When `backend === 'redis'` and the redis backend cannot be constructed (e.g. the
   * `ioredis` package is not installed), fall back to the in-memory backend instead of
   * throwing. A warning is logged. Default: `true`.
   */
  fallbackToMemory?: boolean;
  /**
   * Per-operation timeout in milliseconds. If a backend call (get/set/del/clear/size) does
   * not settle within this window, the operation resolves to a safe fallback (cache miss
   * for `get`, no-op for writes, `0` for `size`). Protects callers from a slow/unreachable
   * Redis instance. Default: 1000. Set to `0` to disable.
   */
  operationTimeoutMs?: number;
}

/**
 * Redis backend options. Pass through any ioredis `RedisOptions` field (host, port,
 * password, tls, sentinels, etc.) plus a `keyPrefix` used by this lib for scoping
 * `clear()` and `size()` scans.
 */
export interface RedisCacheOptions {
  host?: string;
  port?: number;
  password?: string;
  username?: string;
  db?: number;
  tls?: Record<string, unknown>;
  /** Key prefix in Redis. Default: `'sdcore:cache:'`. */
  keyPrefix?: string;
  /** Pass-through for additional ioredis options. */
  [key: string]: unknown;
}

/** DI token for the resolved `CacheConfig`. */
export const CACHE_CONFIG = Symbol('CACHE_CONFIG');

export interface CacheEntry<T = unknown> {
  value: T;
  expiresAt: number; // epoch ms; 0 = no expiry
}
