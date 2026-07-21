import 'reflect-metadata';
import { type CallHandler, type ExecutionContext } from '@nestjs/common';
import { firstValueFrom, from, of } from 'rxjs';
import { ContextService } from '../../core/context/context.service';
import type { RequestContext } from '../../core/context/types';
import { CacheService } from './cache.service';
import { CacheInterceptor } from './cache.interceptor';
import { Cached } from './decorators/cached.decorator';

declare module '../../core/context/types' {
  interface RequestContext {
    businessUnitCode?: string;
  }
}

class TestService {
  @Cached({ scope: 'global', ttl: 60 })
  global(input: number): number {
    return input * 2;
  }

  @Cached({ scope: 'tenant' })
  tenant(input: number): number {
    return input;
  }

  @Cached({ scope: 'user' })
  user(input: number): number {
    return input;
  }

  @Cached({ scope: 'tenant', keyResolver: () => 'fixed-business-key' })
  byResolver(input: number): number {
    return input;
  }

  @Cached({ scope: 'tenant', keyResolver: () => 'fixed-business-key' })
  otherResolver(input: number): number {
    return input;
  }

  @Cached({} as never)
  legacyUnsafe(input: number): number {
    return input;
  }

  uncached(): string {
    return 'plain';
  }
}

const buildExecCtx = (target: object, methodName: string, args: unknown[], request?: Record<string, unknown>): ExecutionContext => {
  const path = `/cache-test/${methodName}`;
  const httpRequest = request ?? {
    method: 'GET',
    originalUrl: path,
    path,
    params: {},
    query: { args },
    body: undefined,
  };
  return {
    getHandler: () => (target as Record<string, unknown>)[methodName] as () => unknown,
    getClass: () => target.constructor,
    getArgs: () => {
      throw new Error('CacheInterceptor must not read raw Nest transport arguments');
    },
    switchToHttp: () => ({ getRequest: () => httpRequest }),
  } as unknown as ExecutionContext;
};

const invoke = async <T>(
  interceptor: CacheInterceptor,
  target: object,
  methodName: string,
  args: unknown[],
  produce: () => T,
): Promise<T> =>
  firstValueFrom(
    interceptor.intercept(buildExecCtx(target, methodName, args), {
      handle: () => of(produce()),
    }),
  ) as Promise<T>;

const contextHarness = (initial?: RequestContext) => {
  let current = initial;
  return {
    service: {
      get store(): RequestContext | undefined {
        return current;
      },
    } as unknown as ContextService,
    set(store: RequestContext | undefined): void {
      current = store;
    },
  };
};

describe('CacheInterceptor', () => {
  it('caches an explicitly global value without request context', async () => {
    const cache = new CacheService({ ttl: 60 });
    const interceptor = new CacheInterceptor(cache);
    const service = new TestService();
    let calls = 0;

    expect(await invoke(interceptor, service, 'global', [5], () => (++calls, 10))).toBe(10);
    expect(await invoke(interceptor, service, 'global', [5], () => (++calls, 99))).toBe(10);
    expect(calls).toBe(1);
    await expect(cache.size()).resolves.toBe(1);
  });

  it('bypasses cache when a tenant scope has no tenant context', async () => {
    const cache = new CacheService();
    const interceptor = new CacheInterceptor(cache);
    const service = new TestService();
    let calls = 0;

    expect(await invoke(interceptor, service, 'tenant', [1], () => ++calls)).toBe(1);
    expect(await invoke(interceptor, service, 'tenant', [1], () => ++calls)).toBe(2);
    await expect(cache.size()).resolves.toBe(0);
  });

  it('bypasses legacy or invalid metadata without an explicit scope', async () => {
    const cache = new CacheService();
    const interceptor = new CacheInterceptor(cache);
    const service = new TestService();
    let calls = 0;

    await invoke(interceptor, service, 'legacyUnsafe', [1], () => ++calls);
    await invoke(interceptor, service, 'legacyUnsafe', [1], () => ++calls);
    expect(calls).toBe(2);
    await expect(cache.size()).resolves.toBe(0);
  });

  it.each([
    [{ userId: 'u1' }, 'tenant'],
    [{ tenant: 't1' }, 'userId'],
  ] as const)('bypasses a user scope when %s lacks %s', async (store, _missing) => {
    const cache = new CacheService();
    const harness = contextHarness(store);
    const interceptor = new CacheInterceptor(cache, harness.service);
    const service = new TestService();
    let calls = 0;

    await invoke(interceptor, service, 'user', [1], () => ++calls);
    await invoke(interceptor, service, 'user', [1], () => ++calls);
    expect(calls).toBe(2);
    await expect(cache.size()).resolves.toBe(0);
  });

  it('separates tenant-scoped entries across tenants', async () => {
    const cache = new CacheService();
    const harness = contextHarness({ tenant: 't1' });
    const interceptor = new CacheInterceptor(cache, harness.service);
    const service = new TestService();
    let calls = 0;

    expect(await invoke(interceptor, service, 'tenant', [7], () => `tenant-${++calls}`)).toBe('tenant-1');
    harness.set({ tenant: 't2' });
    expect(await invoke(interceptor, service, 'tenant', [7], () => `tenant-${++calls}`)).toBe('tenant-2');
    harness.set({ tenant: 't1' });
    expect(await invoke(interceptor, service, 'tenant', [7], () => `tenant-${++calls}`)).toBe('tenant-1');
    expect(calls).toBe(2);
  });

  it('does not share entries between tenant IDs Aa and BB that collide under the legacy 32-bit hash', async () => {
    const cache = new CacheService();
    const harness = contextHarness({ tenant: 'Aa' });
    const interceptor = new CacheInterceptor(cache, harness.service);
    const service = new TestService();
    let calls = 0;

    expect(await invoke(interceptor, service, 'tenant', [7], () => `tenant-${++calls}`)).toBe('tenant-1');
    harness.set({ tenant: 'BB' });
    expect(await invoke(interceptor, service, 'tenant', [7], () => `tenant-${++calls}`)).toBe('tenant-2');
    harness.set({ tenant: 'Aa' });
    expect(await invoke(interceptor, service, 'tenant', [7], () => `tenant-${++calls}`)).toBe('tenant-1');
    expect(calls).toBe(2);
    await expect(cache.size()).resolves.toBe(2);
  });

  it('keeps tenant and request values out of the persisted cache key', async () => {
    const keys: string[] = [];
    const cache = {
      load: async <T>(key: string, factory: () => Promise<T>): Promise<T> => {
        keys.push(key);
        return factory();
      },
    } as unknown as CacheService;
    const harness = contextHarness({ tenant: 'sensitive-tenant-id' });
    const interceptor = new CacheInterceptor(cache, harness.service);
    const service = new TestService();
    const execCtx = buildExecCtx(service, 'tenant', [], {
      method: 'POST',
      originalUrl: '/cache-test/tenant?token=sensitive-query-token',
      path: '/cache-test/tenant',
      params: { id: 'sensitive-resource-id' },
      query: { token: 'sensitive-query-token' },
      body: { password: 'sensitive-body-value' },
    });

    await firstValueFrom(interceptor.intercept(execCtx, { handle: () => of('value') }));
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^TestService\.tenant:[0-9a-f]{64}:[0-9a-f]{64}$/u);
    for (const secret of ['sensitive-tenant-id', 'sensitive-query-token', 'sensitive-resource-id', 'sensitive-body-value']) {
      expect(keys[0]).not.toContain(secret);
    }
  });

  it('separates user-scoped entries across users in the same tenant', async () => {
    const cache = new CacheService();
    const harness = contextHarness({ tenant: 't1', userId: 'u1' });
    const interceptor = new CacheInterceptor(cache, harness.service);
    const service = new TestService();
    let calls = 0;

    expect(await invoke(interceptor, service, 'user', [7], () => `user-${++calls}`)).toBe('user-1');
    harness.set({ tenant: 't1', userId: 'u2' });
    expect(await invoke(interceptor, service, 'user', [7], () => `user-${++calls}`)).toBe('user-2');
    harness.set({ tenant: 't1', userId: 'u1' });
    expect(await invoke(interceptor, service, 'user', [7], () => `user-${++calls}`)).toBe('user-1');
    expect(calls).toBe(2);
  });

  it('varies non-global keys by locale and permission-sensitive context', async () => {
    const cache = new CacheService();
    const harness = contextHarness({
      tenant: 't1',
      lang: 'en',
      permissionVersion: 'v1',
      permissions: ['read'],
      roles: ['viewer'],
    });
    const interceptor = new CacheInterceptor(cache, harness.service);
    const service = new TestService();
    let calls = 0;

    await invoke(interceptor, service, 'tenant', [1], () => ++calls);
    harness.set({ tenant: 't1', lang: 'vi', permissionVersion: 'v1', permissions: ['read'], roles: ['viewer'] });
    await invoke(interceptor, service, 'tenant', [1], () => ++calls);
    harness.set({ tenant: 't1', lang: 'vi', permissionVersion: 'v2', permissions: ['read'], roles: ['viewer'] });
    await invoke(interceptor, service, 'tenant', [1], () => ++calls);
    harness.set({ tenant: 't1', lang: 'vi', permissionVersion: 'v2', permissions: ['write'], roles: ['editor'] });
    await invoke(interceptor, service, 'tenant', [1], () => ++calls);
    expect(calls).toBe(4);
    await expect(cache.size()).resolves.toBe(4);
  });

  it('keeps the security and method namespace when a custom keyResolver is used', async () => {
    const cache = new CacheService();
    const harness = contextHarness({ tenant: 't1' });
    const interceptor = new CacheInterceptor(cache, harness.service);
    const service = new TestService();
    let calls = 0;

    expect(await invoke(interceptor, service, 'byResolver', [1], () => `value-${++calls}`)).toBe('value-1');
    expect(await invoke(interceptor, service, 'byResolver', [999], () => `value-${++calls}`)).toBe('value-1');
    expect(await invoke(interceptor, service, 'otherResolver', [1], () => `value-${++calls}`)).toBe('value-2');
    harness.set({ tenant: 't2' });
    expect(await invoke(interceptor, service, 'byResolver', [1], () => `value-${++calls}`)).toBe('value-3');
    expect(calls).toBe(3);
  });

  it('separates custom domain context even when a custom keyResolver returns the same business key', async () => {
    const cache = new CacheService();
    const harness = contextHarness({ tenant: 't1', roles: ['viewer'], custom: { department: 'sales' } });
    const interceptor = new CacheInterceptor(cache, harness.service);
    const service = new TestService();
    let calls = 0;

    expect(await invoke(interceptor, service, 'byResolver', [1], () => `value-${++calls}`)).toBe('value-1');
    harness.set({ tenant: 't1', roles: ['viewer'], custom: { department: 'finance' } });
    expect(await invoke(interceptor, service, 'byResolver', [1], () => `value-${++calls}`)).toBe('value-2');
    harness.set({ tenant: 't1', roles: ['viewer'], custom: { department: 'sales' } });
    expect(await invoke(interceptor, service, 'byResolver', [1], () => `value-${++calls}`)).toBe('value-1');
    expect(calls).toBe(2);
    await expect(cache.size()).resolves.toBe(2);
  });

  it('separates declaration-merged top-level domain context fields', async () => {
    const cache = new CacheService();
    const harness = contextHarness({ tenant: 't1', businessUnitCode: 'north' });
    const interceptor = new CacheInterceptor(cache, harness.service);
    const service = new TestService();
    let calls = 0;

    expect(await invoke(interceptor, service, 'byResolver', [1], () => `value-${++calls}`)).toBe('value-1');
    harness.set({ tenant: 't1', businessUnitCode: 'south' });
    expect(await invoke(interceptor, service, 'byResolver', [1], () => `value-${++calls}`)).toBe('value-2');
    harness.set({ tenant: 't1', businessUnitCode: 'north' });
    expect(await invoke(interceptor, service, 'byResolver', [1], () => `value-${++calls}`)).toBe('value-1');
    expect(calls).toBe(2);
  });

  it('bypasses caching when included custom context is circular', async () => {
    const cache = new CacheService();
    const custom: Record<string, unknown> = { department: 'sales' };
    custom.self = custom;
    const harness = contextHarness({ tenant: 't1', custom });
    const interceptor = new CacheInterceptor(cache, harness.service);
    const service = new TestService();
    let calls = 0;

    expect(await invoke(interceptor, service, 'byResolver', [1], () => ++calls)).toBe(1);
    expect(await invoke(interceptor, service, 'byResolver', [1], () => ++calls)).toBe(2);
    await expect(cache.size()).resolves.toBe(0);
  });

  it('keeps roles and permissions order-independent', async () => {
    const cache = new CacheService();
    const harness = contextHarness({ tenant: 't1', roles: ['viewer', 'editor'], permissions: ['write', 'read'] });
    const interceptor = new CacheInterceptor(cache, harness.service);
    const service = new TestService();
    let calls = 0;

    expect(await invoke(interceptor, service, 'tenant', [1], () => ++calls)).toBe(1);
    harness.set({ tenant: 't1', roles: ['editor', 'viewer'], permissions: ['read', 'write'] });
    expect(await invoke(interceptor, service, 'tenant', [1], () => ++calls)).toBe(1);
    expect(calls).toBe(1);
  });

  it('keeps tenant scope shared across users while user scope includes userId', async () => {
    const cache = new CacheService();
    const harness = contextHarness({ tenant: 't1', userId: 'u1' });
    const interceptor = new CacheInterceptor(cache, harness.service);
    const service = new TestService();
    let tenantCalls = 0;
    let userCalls = 0;

    expect(await invoke(interceptor, service, 'tenant', [1], () => ++tenantCalls)).toBe(1);
    expect(await invoke(interceptor, service, 'user', [1], () => ++userCalls)).toBe(1);
    harness.set({ tenant: 't1', userId: 'u2' });
    expect(await invoke(interceptor, service, 'tenant', [1], () => ++tenantCalls)).toBe(1);
    expect(await invoke(interceptor, service, 'user', [1], () => ++userCalls)).toBe(2);
    expect(tenantCalls).toBe(1);
    expect(userCalls).toBe(2);
  });

  it('preserves single-flight behavior for concurrent misses', async () => {
    const cache = new CacheService({ ttl: 60 });
    const interceptor = new CacheInterceptor(cache);
    const service = new TestService();
    let calls = 0;
    const handler: CallHandler = {
      handle: () =>
        from(
          new Promise<number>((resolve) =>
            setTimeout(() => {
              calls++;
              resolve(99);
            }, 10),
          ),
        ),
    };
    const ctx = buildExecCtx(service, 'global', [7]);

    const [left, right] = await Promise.all([
      firstValueFrom(interceptor.intercept(ctx, handler)),
      firstValueFrom(interceptor.intercept(ctx, handler)),
    ]);
    expect(left).toBe(99);
    expect(right).toBe(99);
    expect(calls).toBe(1);
  });

  it('bypasses cache when a method is not decorated', async () => {
    const cache = new CacheService();
    const interceptor = new CacheInterceptor(cache);
    const service = new TestService();
    const handler: CallHandler = { handle: () => of(service.uncached()) };

    await expect(firstValueFrom(interceptor.intercept(buildExecCtx(service, 'uncached', []), handler))).resolves.toBe('plain');
    await expect(cache.size()).resolves.toBe(0);
  });

  it('bypasses non-HTTP contexts and circular HTTP key material', async () => {
    const cache = new CacheService();
    const interceptor = new CacheInterceptor(cache);
    const service = new TestService();
    let calls = 0;
    const base = buildExecCtx(service, 'global', [1]) as unknown as Record<string, unknown>;
    const nonHttp = {
      ...base,
      switchToHttp: () => ({ getRequest: () => undefined }),
    } as unknown as ExecutionContext;
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const circularHttp = buildExecCtx(service, 'global', [1], {
      method: 'POST',
      originalUrl: '/cache-test/global',
      path: '/cache-test/global',
      params: {},
      query: {},
      body: circular,
    });
    const handler: CallHandler = { handle: () => of(++calls) };

    await firstValueFrom(interceptor.intercept(nonHttp, handler));
    await firstValueFrom(interceptor.intercept(nonHttp, handler));
    await firstValueFrom(interceptor.intercept(circularHttp, handler));
    await firstValueFrom(interceptor.intercept(circularHttp, handler));
    expect(calls).toBe(4);
    await expect(cache.size()).resolves.toBe(0);
  });
});
