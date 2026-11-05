import { Test } from '@nestjs/testing';
import { SingleFlightService } from './index';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('SingleFlightService', () => {
  it('shares one promise and the first factory result for concurrent callers', async () => {
    const service = new SingleFlightService();
    const work = deferred<object>();
    const factory = jest.fn(() => work.promise);
    const ignored = jest.fn(() => ({}));
    const first = service.run('key', factory);
    const followers = Array.from({ length: 100 }, () => service.run('key', ignored));
    for (const follower of followers) expect(follower).toBe(first);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(ignored).not.toHaveBeenCalled();
    const value = {};
    work.resolve(value);
    for (const result of await Promise.all([first, ...followers])) expect(result).toBe(value);
    await expect(service.run('key', () => 'fresh')).resolves.toBe('fresh');
  });

  it('runs different keys and instances independently while another flight is pending', async () => {
    const service = new SingleFlightService();
    const work = deferred<number>();
    const pending = service.run('key', () => work.promise);
    await expect(service.run('other', () => 2)).resolves.toBe(2);
    await expect(new SingleFlightService().run('key', () => 3)).resolves.toBe(3);
    work.resolve(1);
    await expect(pending).resolves.toBe(1);
  });

  it.each(['throw', 'reject'] as const)('shares the same error and permits an explicit retry after %s', async (failure) => {
    const service = new SingleFlightService();
    const error = new Error('failed');
    const factory = jest.fn(() => {
      if (failure === 'throw') throw error;
      return Promise.reject(error);
    });
    const calls = Array.from({ length: 100 }, () => service.run('key', factory));
    const results = await Promise.allSettled(calls);
    expect(factory).toHaveBeenCalledTimes(1);
    for (const result of results) {
      expect(result.status).toBe('rejected');
      if (result.status === 'rejected') expect(result.reason).toBe(error);
    }
    await expect(service.run('key', () => 'retried')).resolves.toBe('retried');
  });

  it.each([undefined, null, false, 0])('does not retain settled result %p', async (value) => {
    const service = new SingleFlightService();
    const factory = jest.fn(() => value);
    await expect(service.run('', factory)).resolves.toBe(value);
    await expect(service.run('', factory)).resolves.toBe(value);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('cleans up before observers start a new flight and keeps that new flight shared', async () => {
    const service = new SingleFlightService();
    const next = deferred<number>();
    const first = service.run('key', () => 1);
    let second!: Promise<number>;
    const observer = first.then(() => {
      second = service.run('key', () => next.promise);
    });
    await observer;
    const ignored = jest.fn(() => 99);
    expect(service.run('key', ignored)).toBe(second);
    next.resolve(2);
    await expect(second).resolves.toBe(2);
    expect(ignored).not.toHaveBeenCalled();
  });

  it('registers the flight before a factory calls run again without awaiting itself', async () => {
    const service = new SingleFlightService();
    const ignored = jest.fn(() => 2);
    let nested!: Promise<number>;
    const first = service.run('key', () => {
      nested = service.run('key', ignored);
      return 1;
    });
    await expect(first).resolves.toBe(1);
    expect(nested).toBe(first);
    expect(ignored).not.toHaveBeenCalled();
  });

  it('can be registered as a Nest provider', async () => {
    const moduleRef = await Test.createTestingModule({ providers: [SingleFlightService] }).compile();
    await expect(moduleRef.get(SingleFlightService).run('key', () => 42)).resolves.toBe(42);
    await moduleRef.close();
  });
});
