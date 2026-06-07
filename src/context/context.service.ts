import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { RequestContext } from './types';

/**
 * Singleton request-context accessor backed by Node's native `AsyncLocalStorage`.
 * Replaces the legacy static `SdContext` + `cls-hooked` pair from `be-masterdata/core-be`.
 *
 * Scope is `DEFAULT` (singleton) — ALS gives per-request isolation without forcing the DI
 * graph into request-scope (perf cliff).
 *
 * Accessors only cover framework-generic fields. Domain values live in `store.custom` or
 * via declaration-merged `RequestContext` extensions in your app.
 */
@Injectable()
export class ContextService {
  private readonly als = new AsyncLocalStorage<RequestContext>();

  run<R>(store: RequestContext, fn: () => R): R {
    return this.als.run(store, fn);
  }

  /** Current store, or `undefined` outside any request scope. */
  get store(): RequestContext | undefined {
    return this.als.getStore();
  }

  get<K extends keyof RequestContext>(key: K): RequestContext[K] | undefined {
    return this.als.getStore()?.[key];
  }

  set<K extends keyof RequestContext>(key: K, value: RequestContext[K]): void {
    const store = this.als.getStore();
    if (store) store[key] = value;
  }

  /** Read a consumer-defined value from `ctx.custom`. */
  getCustom<T = unknown>(key: string): T | undefined {
    return this.als.getStore()?.custom?.[key] as T | undefined;
  }

  get userId(): string | undefined {
    return this.get('userId');
  }
  get tenant(): string | undefined {
    return this.get('tenant');
  }
  /** Raw language string from headers (e.g. `'en-US,vi;q=0.9'`); consumer parses to a locale code. */
  get lang(): string | undefined {
    return this.get('lang');
  }
  get token(): string | undefined {
    return this.get('token');
  }
  get user(): unknown {
    return this.get('user');
  }
  get permissions(): string[] {
    return this.get('permissions') ?? [];
  }

  hasPermission(code: string): boolean {
    return this.permissions.includes(code);
  }
}
