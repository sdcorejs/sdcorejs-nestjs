export type CacheBackendKind = 'memory' | 'redis';

/**
 * Security boundary used when constructing a `@Cached` method's mandatory namespace. Non-global
 * scopes automatically fingerprint all JSON-safe domain/security request-context fields.
 */
export type CacheScope = 'global' | 'tenant' | 'user';

/** JSON-like values permitted in cache request descriptors and custom business-key material. */
export type CacheKeyValue =
  string | number | boolean | null | undefined | readonly CacheKeyValue[] | { readonly [key: string]: CacheKeyValue };

/**
 * Safe, transport-specific input for an HTTP cache business key. It intentionally excludes
 * request/response objects and headers. All values are canonicalized and fed only into SHA-256.
 */
export interface CacheHttpRequestDescriptor {
  readonly method: string;
  readonly url: string;
  readonly path: string;
  readonly params: Readonly<Record<string, CacheKeyValue>>;
  readonly query: Readonly<Record<string, CacheKeyValue>>;
  readonly body: CacheKeyValue;
}

/** Selects JSON-safe business-key material from a normalized HTTP request descriptor. */
export type CacheKeyResolver = (request: CacheHttpRequestDescriptor, methodName: string) => CacheKeyValue;

interface CacheConfigBase {
  /** Backend driver. Default: `'memory'` (in-process LRU). */
  backend?: CacheBackendKind;
  /** Default TTL in seconds. `0` disables expiry. Default: 60. */
  ttl?: number;
  /** Max entries — memory backend only. Default: 1000. */
  maxEntries?: number;
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

/** In-process cache configuration. This is also the default when `backend` is omitted. */
export interface MemoryCacheConfig extends CacheConfigBase {
  backend?: 'memory';
  /** Redis options are rejected by the type contract unless the Redis backend is selected. */
  redis?: never;
}

/** Redis cache configuration with an explicit, application-specific key namespace. */
export interface RedisCacheConfig extends CacheConfigBase {
  backend: 'redis';
  /** Required Redis connection and key namespace options. */
  redis: RedisCacheOptions;
}

/** Backend-discriminated cache configuration. */
export type CacheConfig = MemoryCacheConfig | RedisCacheConfig;

/**
 * Redis backend options. Pass through any ioredis `RedisOptions` field (host, port,
 * password, tls, sentinels, etc.) plus an explicit `keyPrefix` used by this lib for scoping
 * `clear()` and `size()` scans. The prefix must be nonblank and may not contain Redis glob
 * metacharacters because those operations use `SCAN MATCH`.
 */
export interface RedisCacheOptions {
  host?: string;
  port?: number;
  password?: string;
  username?: string;
  db?: number;
  tls?: Record<string, unknown>;
  /**
   * Required application-specific Redis namespace. It must be nonblank and contain none of
   * `*`, `?`, `[`, `]`, or `\\`. There is deliberately no shared default prefix.
   */
  keyPrefix: string;
  /** Pass-through for additional ioredis options. */
  [key: string]: unknown;
}

/** DI token for the resolved `CacheConfig`. */
export const CACHE_CONFIG = Symbol('CACHE_CONFIG');

export interface CacheEntry<T = unknown> {
  value: T;
  expiresAt: number; // epoch ms; 0 = no expiry
}
