export interface CacheConfig {
  backend?: 'memory';
  /** Default TTL in seconds. `0` disables expiry. Default: 60. */
  ttl?: number;
  /** Max entries in the in-memory LRU. Default: 1000. */
  maxEntries?: number;
}

/** DI token for the resolved `CacheConfig`. */
export const CACHE_CONFIG = Symbol('CACHE_CONFIG');

export interface CacheEntry<T = unknown> {
  value: T;
  expiresAt: number; // epoch ms; 0 = no expiry
}
