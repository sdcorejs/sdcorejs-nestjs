import 'reflect-metadata';
import { MemoryCacheBackend } from '../memory-cache.backend';

describe('MemoryCacheBackend', () => {
  afterEach(() => jest.restoreAllMocks());

  it('stores and retrieves a value', async () => {
    const c = new MemoryCacheBackend(10, 60);
    await c.set('k', { a: 1 });
    expect(await c.get('k')).toEqual({ a: 1 });
  });

  it('returns undefined for a missing key', async () => {
    const c = new MemoryCacheBackend(10, 60);
    expect(await c.get('nope')).toBeUndefined();
  });

  it('expires entries after the TTL and deletes them', async () => {
    const c = new MemoryCacheBackend(10, 1); // 1s default TTL
    const now = 1_000_000;
    jest.spyOn(Date, 'now').mockReturnValue(now);
    await c.set('k', 'v');
    jest.spyOn(Date, 'now').mockReturnValue(now + 2000); // +2s → expired
    expect(await c.get('k')).toBeUndefined();
    expect(await c.size()).toBe(0);
  });

  it('ttl=0 keeps the entry until evicted', async () => {
    const c = new MemoryCacheBackend(10, 60);
    const now = 1_000_000;
    jest.spyOn(Date, 'now').mockReturnValue(now);
    await c.set('k', 'v', 0);
    jest.spyOn(Date, 'now').mockReturnValue(now + 10_000_000);
    expect(await c.get('k')).toBe('v');
  });

  it('evicts the oldest entry when capacity is exceeded', async () => {
    const c = new MemoryCacheBackend(2, 60);
    await c.set('a', 1);
    await c.set('b', 2);
    await c.set('c', 3); // 'a' should be evicted
    expect(await c.get('a')).toBeUndefined();
    expect(await c.get('b')).toBe(2);
    expect(await c.get('c')).toBe(3);
    expect(await c.size()).toBe(2);
  });

  it('LRU touch on get protects a recently-read entry from eviction', async () => {
    const c = new MemoryCacheBackend(2, 60);
    await c.set('a', 1);
    await c.set('b', 2);
    await c.get('a'); // touch 'a' → 'b' is now oldest
    await c.set('c', 3); // evicts 'b'
    expect(await c.get('a')).toBe(1);
    expect(await c.get('b')).toBeUndefined();
  });

  it('del and clear remove entries', async () => {
    const c = new MemoryCacheBackend(10, 60);
    await c.set('a', 1);
    await c.set('b', 2);
    await c.del('a');
    expect(await c.get('a')).toBeUndefined();
    await c.clear();
    expect(await c.size()).toBe(0);
  });
});
