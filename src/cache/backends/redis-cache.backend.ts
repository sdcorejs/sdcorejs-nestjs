import type { CacheBackend } from './cache-backend';
import type { RedisCacheOptions } from '../types';

/**
 * Minimal subset of the ioredis client surface we depend on. Typed loosely so the lib does
 * not pull ioredis into its public type graph — consumers install `ioredis` themselves when
 * they pick the redis backend.
 */
interface RedisLikeClient {
  get(key: string): Promise<string | null>;
  set(...args: unknown[]): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
  scan(cursor: string, ...args: unknown[]): Promise<[string, string[]]>;
  quit(): Promise<unknown>;
  disconnect?(): void;
}

type RedisCtor = new (opts: Record<string, unknown>) => RedisLikeClient;

const DEFAULT_PREFIX = 'sdcore:cache:';
const SCAN_BATCH = 100;

/**
 * Redis-backed cache. Values are JSON-serialised. TTL maps to Redis `EX` seconds.
 * `clear()` and `size()` are scoped to `keyPrefix` via SCAN — never `FLUSHDB`.
 *
 * Construction lazily `require`s `ioredis`; a friendly error is thrown when the package
 * is not installed. Pass any extra ioredis options through the `redis` config field.
 */
export class RedisCacheBackend implements CacheBackend {
  private readonly client: RedisLikeClient;
  private readonly prefix: string;

  constructor(opts: RedisCacheOptions, private readonly defaultTtlSec: number) {
    const { keyPrefix, ...redisOpts } = opts;
    this.prefix = keyPrefix ?? DEFAULT_PREFIX;
    this.client = this.createClient(redisOpts as Record<string, unknown>);
  }

  private createClient(opts: Record<string, unknown>): RedisLikeClient {
    let mod: unknown;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      mod = require('ioredis');
    } catch {
      throw new Error(
        "Cache backend 'redis' requires the 'ioredis' package. Install it: npm i ioredis",
      );
    }
    const Ctor = ((mod as { default?: RedisCtor }).default ?? (mod as RedisCtor)) as RedisCtor;
    return new Ctor(opts);
  }

  private k(key: string): string {
    return `${this.prefix}${key}`;
  }

  async get<T = unknown>(key: string): Promise<T | undefined> {
    const raw = await this.client.get(this.k(key));
    if (raw === null) return undefined;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return undefined;
    }
  }

  async set<T>(key: string, value: T, ttlSec?: number): Promise<void> {
    const ttl = ttlSec ?? this.defaultTtlSec;
    const payload = JSON.stringify(value);
    if (ttl > 0) {
      await this.client.set(this.k(key), payload, 'EX', ttl);
    } else {
      await this.client.set(this.k(key), payload);
    }
  }

  async del(key: string): Promise<void> {
    await this.client.del(this.k(key));
  }

  async clear(): Promise<void> {
    const match = `${this.prefix}*`;
    let cursor = '0';
    do {
      const [next, keys] = await this.client.scan(cursor, 'MATCH', match, 'COUNT', SCAN_BATCH);
      cursor = next;
      if (keys.length) await this.client.del(...keys);
    } while (cursor !== '0');
  }

  async size(): Promise<number> {
    const match = `${this.prefix}*`;
    let cursor = '0';
    let count = 0;
    do {
      const [next, keys] = await this.client.scan(cursor, 'MATCH', match, 'COUNT', SCAN_BATCH);
      cursor = next;
      count += keys.length;
    } while (cursor !== '0');
    return count;
  }

  async dispose(): Promise<void> {
    try {
      await this.client.quit();
    } catch {
      this.client.disconnect?.();
    }
  }
}
