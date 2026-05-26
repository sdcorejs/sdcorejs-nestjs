/**
 * Pluggable cache backend contract. All operations are async so the same surface fits both
 * in-process stores (memory) and out-of-process stores (Redis, Memcached, etc.).
 */
export interface CacheBackend {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlSec?: number): Promise<void>;
  del(key: string): Promise<void>;
  clear(): Promise<void>;
  size(): Promise<number>;
}
