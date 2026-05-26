import 'reflect-metadata';
import { type CallHandler, type ExecutionContext } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';
import { CacheService } from './cache.service';
import { CacheInterceptor } from './cache.interceptor';
import { Cached } from './decorators/cached.decorator';

class TestService {
  callCount = 0;
  @Cached({ ttl: 60 })
  expensive(input: number): number {
    this.callCount++;
    return input * 2;
  }

  uncached(): string {
    return 'plain';
  }
}

const buildExecCtx = (target: object, methodName: string, args: unknown[]): ExecutionContext =>
  ({
    getHandler: () => (target as Record<string, unknown>)[methodName] as () => unknown,
    getClass: () => target.constructor,
    getArgs: () => args,
  }) as unknown as ExecutionContext;

describe('CacheInterceptor', () => {
  it('caches @Cached return values + serves second call from cache', async () => {
    const cache = new CacheService({ ttl: 60 });
    const interceptor = new CacheInterceptor(cache);
    const service = new TestService();

    const handler1: CallHandler = { handle: () => of(service.expensive(5)) };
    const result1 = await firstValueFrom(interceptor.intercept(buildExecCtx(service, 'expensive', [5]), handler1));
    expect(result1).toBe(10);
    expect(service.callCount).toBe(1);

    // Allow microtask queue to flush the fire-and-forget cache.set in `tap`
    await Promise.resolve();

    let handler2Called = false;
    const handler2: CallHandler = {
      handle: () => {
        handler2Called = true;
        return of(service.expensive(5));
      },
    };
    const result2 = await firstValueFrom(interceptor.intercept(buildExecCtx(service, 'expensive', [5]), handler2));
    expect(result2).toBe(10);
    expect(handler2Called).toBe(false);
  });

  it('bypasses cache when method is NOT @Cached', async () => {
    const cache = new CacheService();
    const interceptor = new CacheInterceptor(cache);
    const service = new TestService();
    const handler: CallHandler = { handle: () => of(service.uncached()) };
    const result = await firstValueFrom(interceptor.intercept(buildExecCtx(service, 'uncached', []), handler));
    expect(result).toBe('plain');
    await expect(cache.size()).resolves.toBe(0);
  });

  it('separates cache by argument hash', async () => {
    const cache = new CacheService();
    const interceptor = new CacheInterceptor(cache);
    const service = new TestService();
    let counter = 0;
    const makeHandler = (val: number): CallHandler => ({ handle: () => of(val) });

    await firstValueFrom(interceptor.intercept(buildExecCtx(service, 'expensive', [1]), makeHandler(++counter)));
    await firstValueFrom(interceptor.intercept(buildExecCtx(service, 'expensive', [2]), makeHandler(++counter)));
    await Promise.resolve();
    await expect(cache.size()).resolves.toBe(2);
  });
});
