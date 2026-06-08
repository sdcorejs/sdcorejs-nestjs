import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { CacheBackend } from './backends/cache-backend';
import { MemoryCacheBackend } from './backends/memory-cache.backend';
import { RedisCacheBackend } from './backends/redis-cache.backend';
import { CACHE_CONFIG, type CacheBackendKind, type CacheConfig } from './types';

/**
 * Async key-value cache. Backend (memory LRU or Redis) is selected at module construction
 * via `CacheConfig.backend`. Inject via DI; do not instantiate directly outside tests.
 *
 *   CacheModule.forRoot({ backend: 'memory', ttl: 60, maxEntries: 1000 })
 *   CacheModule.forRoot({ backend: 'redis', ttl: 300, redis: { host: 'localhost', port: 6379 } })
 *
 * Resilience features (ported from be-masterdata's SdCacheService):
 *   - Auto-fallback to memory if the redis backend cannot be constructed (e.g. `ioredis` not
 *     installed). Opt out with `fallbackToMemory: false`.
 *   - Per-op timeout (`operationTimeoutMs`, default 1000ms) — slow/unreachable backend never
 *     stalls the caller; `get` degrades to a cache miss, writes become best-effort no-ops.
 *   - Backend errors are swallowed at the boundary (logged at warn level) and the same
 *     fallback rules apply. The application never sees a thrown cache error.
 *   - Single-flight `get` deduplication — concurrent `get(key)` calls for the same key
 *     share one backend round-trip.
 *   - `load(key, factory, ttl?)` cache-aside helper with factory deduplication.
 */
@Injectable()
export class CacheService implements CacheBackend {
  private static readonly logger = new Logger(CacheService.name);

  private readonly backend: CacheBackend;
  /** Resolved backend kind after construction (reflects any redis→memory fallback). */
  readonly backendKind: CacheBackendKind;
  private readonly timeoutMs: number;

  /** In-flight `get` promises keyed by cache key — single-flight dedup. */
  private readonly getLocks = new Map<string, Promise<unknown>>();
  /** In-flight `load` factory promises keyed by cache key — factory dedup. */
  private readonly loadLocks = new Map<string, Promise<unknown>>();

  constructor(@Optional() @Inject(CACHE_CONFIG) cfg?: CacheConfig) {
    const c = cfg ?? {};
    const ttl = c.ttl ?? 60;
    const fallback = c.fallbackToMemory ?? true;
    this.timeoutMs = c.operationTimeoutMs ?? 1000;
    const memory = () => new MemoryCacheBackend(c.maxEntries ?? 1000, ttl);

    if (c.backend === 'redis') {
      try {
        this.backend = new RedisCacheBackend(c.redis ?? {}, ttl);
        this.backendKind = 'redis';
        return;
      } catch (e) {
        const msg = (e as Error).message;
        if (!fallback) throw e;
        CacheService.logger.warn(`Redis cache backend unavailable, falling back to in-memory cache: ${msg}`);
      }
    }

    this.backend = memory();
    this.backendKind = 'memory';
  }

  // --- public API ---------------------------------------------------------

  async get<T = unknown>(key: string): Promise<T | undefined> {
    const existing = this.getLocks.get(key);
    if (existing) return existing as Promise<T | undefined>;
    const p = this.guarded<T | undefined>(() => this.backend.get<T>(key), undefined, 'get');
    this.getLocks.set(key, p);
    try {
      return await p;
    } finally {
      this.getLocks.delete(key);
    }
  }

  async set<T>(key: string, value: T, ttlSec?: number): Promise<void> {
    await this.guarded<void>(() => this.backend.set(key, value, ttlSec), undefined, 'set');
  }

  async del(key: string): Promise<void> {
    await this.guarded<void>(() => this.backend.del(key), undefined, 'del');
  }

  async clear(): Promise<void> {
    await this.guarded<void>(() => this.backend.clear(), undefined, 'clear');
  }

  async size(): Promise<number> {
    return this.guarded<number>(() => this.backend.size(), 0, 'size');
  }

  /**
   * Cache-aside helper. Returns cached value if present; otherwise calls `factory`, writes
   * the result back into the cache (best-effort), and returns it. Concurrent `load(key, …)`
   * calls share one factory invocation — keyed by `key` alone, so factories registered with
   * different arguments under the same key collapse to the first one.
   *
   * If `factory` returns `undefined`, the value is NOT cached (acts like a soft miss).
   */
  async load<T>(key: string, factory: () => Promise<T>, ttlSec?: number): Promise<T> {
    const hit = await this.get<T>(key);
    if (hit !== undefined) return hit;

    const inflight = this.loadLocks.get(key);
    if (inflight) return inflight as Promise<T>;

    const p = (async () => {
      try {
        const value = await factory();
        if (value !== undefined) await this.set(key, value, ttlSec);
        return value;
      } finally {
        this.loadLocks.delete(key);
      }
    })();
    this.loadLocks.set(key, p);
    return p;
  }

  // --- internals ----------------------------------------------------------

  /**
   * Race a backend op against the configured timeout, swallowing thrown errors. The
   * fallback is returned both on timeout and on thrown error. Logs a warning when the
   * fallback path is taken so silent degradation is observable.
   */
  private async guarded<T>(op: () => Promise<T>, fallback: T, opName: string): Promise<T> {
    const run = (async () => {
      try {
        return await op();
      } catch (e) {
        CacheService.logger.warn(`Cache ${opName} failed, returning fallback: ${(e as Error).message}`);
        return fallback;
      }
    })();

    if (this.timeoutMs <= 0) return run;

    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<T>((resolve) => {
      timer = setTimeout(() => {
        CacheService.logger.warn(`Cache ${opName} timed out after ${this.timeoutMs}ms, returning fallback`);
        resolve(fallback);
      }, this.timeoutMs);
    });

    try {
      return await Promise.race([run, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
