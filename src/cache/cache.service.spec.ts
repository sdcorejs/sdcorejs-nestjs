import { CacheService } from './cache.service';

describe('CacheService', () => {
  let cache: CacheService;

  beforeEach(() => {
    cache = new CacheService({ ttl: 60, maxEntries: 3 });
  });

  it('set + get round-trip', () => {
    cache.set('k', { v: 1 });
    expect(cache.get('k')).toEqual({ v: 1 });
  });

  it('returns undefined for missing key', () => {
    expect(cache.get('absent')).toBeUndefined();
  });

  it('del removes entry', () => {
    cache.set('k', 'v');
    cache.del('k');
    expect(cache.get('k')).toBeUndefined();
  });

  it('clear empties the store', () => {
    cache.set('a', 1);
    cache.set('b', 2);
    cache.clear();
    expect(cache.size()).toBe(0);
  });

  it('expires entry after TTL elapses', () => {
    jest.useFakeTimers();
    cache.set('k', 'v', 1);
    expect(cache.get('k')).toBe('v');
    jest.advanceTimersByTime(2000);
    expect(cache.get('k')).toBeUndefined();
    jest.useRealTimers();
  });

  it('ttl=0 disables expiry', () => {
    jest.useFakeTimers();
    cache.set('k', 'v', 0);
    jest.advanceTimersByTime(100_000_000);
    expect(cache.get('k')).toBe('v');
    jest.useRealTimers();
  });

  it('LRU eviction at capacity', () => {
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    cache.set('d', 4); // evicts 'a' (oldest)
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe(2);
  });

  it('get() promotes key to most-recent in LRU', () => {
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    cache.get('a'); // touch 'a'
    cache.set('d', 4); // evicts 'b' now (a was promoted)
    expect(cache.get('a')).toBe(1);
    expect(cache.get('b')).toBeUndefined();
  });
});
