import { Inject, Injectable, Optional } from '@nestjs/common';
import { CACHE_CONFIG, type CacheConfig, type CacheEntry } from './types';

/**
 * Simple in-memory LRU cache. Use via DI; do not instantiate directly outside tests.
 *
 * Capacity defaults to 1000 entries; oldest-touched eviction. TTL is per-entry — when
 * elapsed, `get` returns `undefined` and deletes the entry. Pass `ttl=0` on `set` to keep
 * an entry until evicted.
 */
@Injectable()
export class CacheService {
  private readonly store = new Map<string, CacheEntry>();
  private readonly maxEntries: number;
  private readonly defaultTtlSec: number;

  constructor(@Optional() @Inject(CACHE_CONFIG) cfg?: CacheConfig) {
    this.maxEntries = cfg?.maxEntries ?? 1000;
    this.defaultTtlSec = cfg?.ttl ?? 60;
  }

  get<T = unknown>(key: string): T | undefined {
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

  set<T>(key: string, value: T, ttlSec?: number): void {
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

  del(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  size(): number {
    return this.store.size;
  }
}
