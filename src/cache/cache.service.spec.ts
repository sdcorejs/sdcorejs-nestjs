import type { CacheBackend } from './backends/cache-backend';
import { CacheService } from './cache.service';

// `ioredis` is an OPTIONAL peer of this lib, but it is now present in node_modules transitively
// (bullmq depends on it). The construction/fallback tests below assert the "ioredis not installed"
// path, so we simulate its absence by making `require('ioredis')` throw — keeping those tests
// deterministic regardless of what else pulls ioredis into the tree.
jest.mock('ioredis', () => {
  throw new Error("Cannot find module 'ioredis'");
});

/** Replace the private backend of a CacheService with a stub. Test-only escape hatch. */
const setBackend = (svc: CacheService, backend: CacheBackend): void => {
  (svc as unknown as { backend: CacheBackend }).backend = backend;
};

describe('CacheService (memory backend)', () => {
  let cache: CacheService;

  beforeEach(() => {
    cache = new CacheService({ ttl: 60, maxEntries: 3 });
  });

  it('set + get round-trip', async () => {
    await cache.set('k', { v: 1 });
    await expect(cache.get('k')).resolves.toEqual({ v: 1 });
  });

  it('returns undefined for missing key', async () => {
    await expect(cache.get('absent')).resolves.toBeUndefined();
  });

  it('del removes entry', async () => {
    await cache.set('k', 'v');
    await cache.del('k');
    await expect(cache.get('k')).resolves.toBeUndefined();
  });

  it('clear empties the store', async () => {
    await cache.set('a', 1);
    await cache.set('b', 2);
    await cache.clear();
    await expect(cache.size()).resolves.toBe(0);
  });

  it('expires entry after TTL elapses', async () => {
    jest.useFakeTimers();
    await cache.set('k', 'v', 1);
    await expect(cache.get('k')).resolves.toBe('v');
    jest.advanceTimersByTime(2000);
    await expect(cache.get('k')).resolves.toBeUndefined();
    jest.useRealTimers();
  });

  it('ttl=0 disables expiry', async () => {
    jest.useFakeTimers();
    await cache.set('k', 'v', 0);
    jest.advanceTimersByTime(100_000_000);
    await expect(cache.get('k')).resolves.toBe('v');
    jest.useRealTimers();
  });

  it('LRU eviction at capacity', async () => {
    await cache.set('a', 1);
    await cache.set('b', 2);
    await cache.set('c', 3);
    await cache.set('d', 4); // evicts 'a' (oldest)
    await expect(cache.get('a')).resolves.toBeUndefined();
    await expect(cache.get('b')).resolves.toBe(2);
  });

  it('get() promotes key to most-recent in LRU', async () => {
    await cache.set('a', 1);
    await cache.set('b', 2);
    await cache.set('c', 3);
    await cache.get('a'); // touch 'a'
    await cache.set('d', 4); // evicts 'b' now (a was promoted)
    await expect(cache.get('a')).resolves.toBe(1);
    await expect(cache.get('b')).resolves.toBeUndefined();
  });
});

describe('CacheService — construction + fallback', () => {
  it("auto-falls back to memory when 'ioredis' is missing", () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const svc = new CacheService({ backend: 'redis' });
    expect(svc.backendKind).toBe('memory');
    warn.mockRestore();
  });

  it('fallbackToMemory=false rethrows when redis backend cannot construct', () => {
    expect(() => new CacheService({ backend: 'redis', fallbackToMemory: false })).toThrow(/ioredis/);
  });

  it('memory backend is the default kind', () => {
    expect(new CacheService().backendKind).toBe('memory');
  });
});

describe('CacheService — resilience (timeout, error swallow, single-flight)', () => {
  // Hide expected warn output from these failure-path tests
  let warnSpy: jest.SpyInstance;
  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => warnSpy.mockRestore());

  it('swallows backend.get errors and returns undefined', async () => {
    const svc = new CacheService();
    setBackend(svc, {
      get: () => Promise.reject(new Error('boom')),
      set: () => Promise.resolve(),
      del: () => Promise.resolve(),
      clear: () => Promise.resolve(),
      size: () => Promise.resolve(0),
    });
    await expect(svc.get('k')).resolves.toBeUndefined();
  });

  it('swallows backend.set errors (no-op, no throw)', async () => {
    const svc = new CacheService();
    setBackend(svc, {
      get: () => Promise.resolve(undefined),
      set: () => Promise.reject(new Error('boom')),
      del: () => Promise.resolve(),
      clear: () => Promise.resolve(),
      size: () => Promise.resolve(0),
    });
    await expect(svc.set('k', 1)).resolves.toBeUndefined();
  });

  it('returns 0 from size() when backend errors', async () => {
    const svc = new CacheService();
    setBackend(svc, {
      get: () => Promise.resolve(undefined),
      set: () => Promise.resolve(),
      del: () => Promise.resolve(),
      clear: () => Promise.resolve(),
      size: () => Promise.reject(new Error('boom')),
    });
    await expect(svc.size()).resolves.toBe(0);
  });

  it('times out a slow backend and returns fallback (cache miss)', async () => {
    const svc = new CacheService({ operationTimeoutMs: 50 });
    setBackend(svc, {
      get: () => new Promise(() => undefined), // never resolves
      set: () => Promise.resolve(),
      del: () => Promise.resolve(),
      clear: () => Promise.resolve(),
      size: () => Promise.resolve(0),
    });
    const start = Date.now();
    await expect(svc.get('k')).resolves.toBeUndefined();
    expect(Date.now() - start).toBeLessThan(500);
  });

  it('operationTimeoutMs=0 disables the timeout race', async () => {
    const svc = new CacheService({ operationTimeoutMs: 0 });
    let resolveGet: (v: unknown) => void = () => undefined;
    setBackend(svc, {
      get: () => new Promise((r) => (resolveGet = r)),
      set: () => Promise.resolve(),
      del: () => Promise.resolve(),
      clear: () => Promise.resolve(),
      size: () => Promise.resolve(0),
    });
    const p = svc.get('k');
    setTimeout(() => resolveGet('late-value'), 20);
    await expect(p).resolves.toBe('late-value');
  });

  it('single-flight: concurrent gets for the same key trigger one backend call', async () => {
    const svc = new CacheService();
    let calls = 0;
    setBackend(svc, {
      get: async () => {
        calls++;
        await new Promise((r) => setTimeout(r, 20));
        return 'v';
      },
      set: () => Promise.resolve(),
      del: () => Promise.resolve(),
      clear: () => Promise.resolve(),
      size: () => Promise.resolve(0),
    });
    const [a, b, c] = await Promise.all([svc.get('k'), svc.get('k'), svc.get('k')]);
    expect([a, b, c]).toEqual(['v', 'v', 'v']);
    expect(calls).toBe(1);
  });
});

describe('CacheService — load() cache-aside', () => {
  it('calls factory on miss and caches the result', async () => {
    const svc = new CacheService();
    let factoryCalls = 0;
    const factory = async () => {
      factoryCalls++;
      return { v: 42 };
    };
    await expect(svc.load('k', factory)).resolves.toEqual({ v: 42 });
    await expect(svc.load('k', factory)).resolves.toEqual({ v: 42 });
    expect(factoryCalls).toBe(1);
  });

  it('deduplicates concurrent loads (factory runs once)', async () => {
    const svc = new CacheService();
    let factoryCalls = 0;
    const factory = async () => {
      factoryCalls++;
      await new Promise((r) => setTimeout(r, 20));
      return 'v';
    };
    const [a, b, c] = await Promise.all([svc.load('k', factory), svc.load('k', factory), svc.load('k', factory)]);
    expect([a, b, c]).toEqual(['v', 'v', 'v']);
    expect(factoryCalls).toBe(1);
  });

  it('does NOT cache undefined factory result (soft miss)', async () => {
    const svc = new CacheService();
    let factoryCalls = 0;
    const factory = async () => {
      factoryCalls++;
      return undefined as unknown as string;
    };
    await svc.load('k', factory);
    await svc.load('k', factory);
    expect(factoryCalls).toBe(2);
  });
});
