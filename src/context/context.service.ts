import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { RequestContext } from './context.types';

/**
 * Singleton request-context accessor backed by Node's native `AsyncLocalStorage`.
 * Replaces the legacy static `SdContext` + `cls-hooked` pair from `be-masterdata/core-be`.
 *
 * `ContextMiddleware` calls `run(store, next)` once per HTTP request — every code path
 * reachable from that callback (including nested `await`, `Promise.all`, `setImmediate`,
 * `setTimeout`) reads the same store via `als.getStore()`.
 *
 * Scope is `DEFAULT` (singleton) — not `REQUEST` — so that other singletons can inject
 * it without forcing the entire DI graph to become request-scoped (perf cliff).
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

  get userId(): string | undefined { return this.get('userId'); }
  get username(): string | undefined { return this.get('username'); }
  get fullName(): string | undefined { return this.get('fullName'); }
  get tenantCode(): string | undefined { return this.get('tenantCode'); }
  get departmentCode(): string | undefined { return this.get('departmentCode'); }
  get project(): string | undefined { return this.get('project'); }
  /** Resolved language, defaults to `'vi'` if not set. */
  get lang(): 'vi' | 'en' { return this.get('lang') ?? 'vi'; }
  get token(): string | undefined { return this.get('token'); }
  get internalSecret(): string | undefined { return this.get('internalSecret'); }
  get user(): unknown { return this.get('user'); }
  get isSystemAdmin(): boolean { return !!this.get('isSystemAdmin'); }
  get isTenantAdmin(): boolean { return !!this.get('isTenantAdmin'); }
  get permissions(): string[] { return this.get('permissions') ?? []; }

  hasPermission(code: string): boolean {
    return this.permissions.includes(code);
  }
}
