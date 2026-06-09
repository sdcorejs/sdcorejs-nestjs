import type { CacheBackend } from './cache-backend';
import type { CacheEntry } from '../types';

/**
 * In-process LRU cache. Capacity is bounded; oldest-touched eviction. TTL is per-entry — when
 * elapsed, `get` returns `undefined` and deletes the entry. Pass `ttl=0` on `set` to keep
 * an entry until evicted.
 */
export class MemoryCacheBackend implements CacheBackend {
  private readonly store = new Map<string, CacheEntry>();

  constructor(
    private readonly maxEntries: number,
    private readonly defaultTtlSec: number,
  ) {}

  async get<T = unknown>(key: string): Promise<T | undefined> {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt > 0 && entry.expiresAt < Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    // LRU touch — re-insert to move to end of Map iteration order
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlSec?: number): Promise<void> {
    const ttl = ttlSec ?? this.defaultTtlSec;
    const expiresAt = ttl > 0 ? Date.now() + ttl * 1000 : 0;
    this.store.delete(key);
    this.store.set(key, { value, expiresAt });
    while (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest === undefined) break;
      this.store.delete(oldest);
    }
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }

  async clear(): Promise<void> {
    this.store.clear();
  }

  async size(): Promise<number> {
    return this.store.size;
  }
}
