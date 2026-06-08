import 'reflect-metadata';

jest.mock('ioredis', () => {
  const client = {
    get: jest.fn(),
    set: jest.fn(async () => 'OK'),
    del: jest.fn(async () => 1),
    scan: jest.fn(async () => ['0', []]),
    quit: jest.fn(async () => 'OK'),
    disconnect: jest.fn(),
  };
  const Ctor = jest.fn(() => client);
  return { __esModule: true, default: Ctor, __client: client };
});

import { RedisCacheBackend } from '../redis-cache.backend';
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
const client = (require('ioredis') as any).__client;

describe('RedisCacheBackend', () => {
  beforeEach(() => jest.clearAllMocks());

  const make = (defaultTtl = 60) => new RedisCacheBackend({ keyPrefix: 'p:' } as never, defaultTtl);

  it('get parses a JSON hit and prefixes the key', async () => {
    client.get.mockResolvedValueOnce(JSON.stringify({ a: 1 }));
    expect(await make().get('k')).toEqual({ a: 1 });
    expect(client.get).toHaveBeenCalledWith('p:k');
  });

  it('get returns undefined on a miss (null)', async () => {
    client.get.mockResolvedValueOnce(null);
    expect(await make().get('k')).toBeUndefined();
  });

  it('get returns undefined on unparseable JSON', async () => {
    client.get.mockResolvedValueOnce('not json{');
    expect(await make().get('k')).toBeUndefined();
  });

  it('set with ttl>0 uses EX seconds', async () => {
    await make().set('k', 'v', 30);
    expect(client.set).toHaveBeenCalledWith('p:k', '"v"', 'EX', 30);
  });

  it('set with ttl<=0 omits expiry', async () => {
    await make(0).set('k', 'v');
    expect(client.set).toHaveBeenCalledWith('p:k', '"v"');
  });

  it('del prefixes the key', async () => {
    await make().del('k');
    expect(client.del).toHaveBeenCalledWith('p:k');
  });

  it('clear SCANs the prefix and deletes matched keys', async () => {
    client.scan.mockResolvedValueOnce(['0', ['p:a', 'p:b']]);
    await make().clear();
    expect(client.scan).toHaveBeenCalledWith('0', 'MATCH', 'p:*', 'COUNT', 100);
    expect(client.del).toHaveBeenCalledWith('p:a', 'p:b');
  });

  it('size counts keys via SCAN', async () => {
    client.scan.mockResolvedValueOnce(['0', ['p:a', 'p:b', 'p:c']]);
    expect(await make().size()).toBe(3);
  });

  it('dispose calls quit', async () => {
    await make().dispose();
    expect(client.quit).toHaveBeenCalled();
  });

  it('dispose falls back to disconnect when quit throws', async () => {
    client.quit.mockRejectedValueOnce(new Error('down'));
    await make().dispose();
    expect(client.disconnect).toHaveBeenCalled();
  });
});
