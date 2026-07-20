import { type CallHandler, type ExecutionContext, Inject, Injectable, type NestInterceptor, Optional } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { firstValueFrom, from, type Observable } from 'rxjs';
import { ContextService } from '../../core/context/context.service';
import type { RequestContext } from '../../core/context/types';
import { CacheService } from './cache.service';
import { CACHED_METADATA, type CachedOptions } from './decorators/cached.decorator';
import type { CacheHttpRequestDescriptor, CacheKeyValue, CacheScope } from './types';

const UNSAFE_CACHE_VALUE = Symbol('UNSAFE_CACHE_VALUE');
const MAX_CACHE_VALUE_DEPTH = 32;
const VOLATILE_CONTEXT_KEYS = new Set(['request', 'response', 'token', 'user']);

/**
 * Interceptor that caches `@Cached`-marked single-value handlers. Every key includes a mandatory
 * class/method and security namespace; tenant/user scopes fail closed by bypassing the cache when
 * their required context values are unavailable.
 */
@Injectable()
export class CacheInterceptor implements NestInterceptor {
  constructor(
    private readonly cache: CacheService,
    @Optional() @Inject(ContextService) private readonly context?: ContextService,
  ) {}

  intercept(execCtx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const handler = execCtx.getHandler();
    const cls = execCtx.getClass();
    const opts: CachedOptions | undefined = Reflect.getMetadata(CACHED_METADATA, cls.prototype, handler.name);
    if (!opts) return next.handle();

    const request = this.buildHttpRequestDescriptor(execCtx);
    if (!request) return next.handle();

    const key = this.buildKey(cls.name, handler.name, request, opts);
    if (!key) return next.handle();

    // Route through `cache.load` for single-flight dedup: N concurrent misses for the same key run
    // the handler ONCE (the rest await the in-flight result) instead of stampeding the downstream.
    // `@Cached` is therefore for single-value (request/response) handlers, not multi-emit streams.
    return from(this.cache.load(key, () => firstValueFrom(next.handle()), opts.ttl));
  }

  private buildKey(className: string, methodName: string, request: CacheHttpRequestDescriptor, opts: CachedOptions): string | undefined {
    const ctx = this.context?.store;
    if (opts.scope !== 'global' && opts.scope !== 'tenant' && opts.scope !== 'user') return undefined;
    const safeScopeMaterial = this.buildScopeMaterial(opts.scope, ctx);
    if (safeScopeMaterial === UNSAFE_CACHE_VALUE) return undefined;
    let businessMaterial: unknown;
    try {
      businessMaterial = opts.keyResolver ? opts.keyResolver(request, methodName) : request;
    } catch {
      return undefined;
    }
    const safeBusinessMaterial = this.toSafeCacheValue(businessMaterial);
    if (safeBusinessMaterial === UNSAFE_CACHE_VALUE) return undefined;

    return `${className}.${methodName}:${this.sha256(safeScopeMaterial)}:${this.sha256(safeBusinessMaterial)}`;
  }

  /**
   * Build the mandatory non-global security namespace from every JSON-safe context field. Domain
   * extensions in `custom` and declaration-merged top-level fields are therefore isolated by
   * default. Runtime object references and credentials are intentionally excluded; tenant scope
   * also excludes `userId` so explicitly tenant-shared results remain shared within that tenant.
   */
  private buildScopeMaterial(scope: CacheScope, context?: RequestContext): CacheKeyValue | typeof UNSAFE_CACHE_VALUE {
    if (scope === 'global') return Object.freeze({ scope });
    if (!context) return UNSAFE_CACHE_VALUE;

    try {
      const prototype = Object.getPrototypeOf(context);
      if (prototype !== Object.prototype && prototype !== null) return UNSAFE_CACHE_VALUE;

      const ownKeys = Reflect.ownKeys(context);
      if (ownKeys.some((key) => typeof key !== 'string')) return UNSAFE_CACHE_VALUE;

      // Null-prototype avoids `__proto__` assignment semantics while copying consumer field names.
      const selected: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      for (const key of (ownKeys as string[]).sort()) {
        if (VOLATILE_CONTEXT_KEYS.has(key) || (scope === 'tenant' && key === 'userId')) continue;

        const property = Object.getOwnPropertyDescriptor(context, key);
        if (!property?.enumerable || !('value' in property)) return UNSAFE_CACHE_VALUE;
        const value = property.value;
        selected[key] =
          (key === 'roles' || key === 'permissions') && Array.isArray(value) && value.every((item) => typeof item === 'string')
            ? [...value].sort()
            : value;
      }

      const safeContext = this.toSafeCacheValue(selected);
      if (safeContext === UNSAFE_CACHE_VALUE || !this.isCacheRecord(safeContext)) return UNSAFE_CACHE_VALUE;
      if (typeof safeContext.tenant !== 'string' || safeContext.tenant.trim().length === 0) return UNSAFE_CACHE_VALUE;
      if (scope === 'user' && (typeof safeContext.userId !== 'string' || safeContext.userId.trim().length === 0)) {
        return UNSAFE_CACHE_VALUE;
      }

      return Object.freeze({ scope, context: safeContext });
    } catch {
      return UNSAFE_CACHE_VALUE;
    }
  }

  private buildHttpRequestDescriptor(execCtx: ExecutionContext): CacheHttpRequestDescriptor | undefined {
    let request: Record<string, unknown> | undefined;
    try {
      const candidate = execCtx.switchToHttp().getRequest<unknown>();
      if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
        request = candidate as Record<string, unknown>;
      }
    } catch {
      return undefined;
    }
    if (!request) return undefined;

    try {
      const method = typeof request.method === 'string' ? request.method.trim().toUpperCase() : '';
      const urlValue = typeof request.originalUrl === 'string' ? request.originalUrl : request.url;
      const url = typeof urlValue === 'string' ? urlValue : '';
      const pathValue = typeof request.path === 'string' ? request.path : url.split(/[?#]/u, 1)[0];
      const path = pathValue || '/';
      if (!method || !url) return undefined;

      const params = this.toSafeCacheValue(request.params ?? {});
      const query = this.toSafeCacheValue(request.query ?? {});
      const body = this.toSafeCacheValue(request.body);
      if (
        params === UNSAFE_CACHE_VALUE ||
        query === UNSAFE_CACHE_VALUE ||
        body === UNSAFE_CACHE_VALUE ||
        !this.isCacheRecord(params) ||
        !this.isCacheRecord(query)
      ) {
        return undefined;
      }

      return Object.freeze({ method, url, path, params, query, body });
    } catch {
      return undefined;
    }
  }

  private toSafeCacheValue(
    value: unknown,
    ancestors: WeakSet<object> = new WeakSet<object>(),
    depth = 0,
  ): CacheKeyValue | typeof UNSAFE_CACHE_VALUE {
    if (depth > MAX_CACHE_VALUE_DEPTH) return UNSAFE_CACHE_VALUE;
    if (value === undefined || value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : UNSAFE_CACHE_VALUE;
    if (typeof value !== 'object') return UNSAFE_CACHE_VALUE;
    if (ancestors.has(value)) return UNSAFE_CACHE_VALUE;

    ancestors.add(value);
    try {
      if (Array.isArray(value)) {
        const items: CacheKeyValue[] = [];
        for (const item of value) {
          const safe = this.toSafeCacheValue(item, ancestors, depth + 1);
          if (safe === UNSAFE_CACHE_VALUE) return UNSAFE_CACHE_VALUE;
          items.push(safe);
        }
        return Object.freeze(items);
      }

      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) return UNSAFE_CACHE_VALUE;
      const entries: Array<[string, CacheKeyValue]> = [];
      const ownKeys = Reflect.ownKeys(value);
      if (ownKeys.some((key) => typeof key !== 'string')) return UNSAFE_CACHE_VALUE;
      for (const key of (ownKeys as string[]).sort()) {
        const property = Object.getOwnPropertyDescriptor(value, key);
        if (!property?.enumerable || !('value' in property)) return UNSAFE_CACHE_VALUE;
        const safe = this.toSafeCacheValue(property.value, ancestors, depth + 1);
        if (safe === UNSAFE_CACHE_VALUE) return UNSAFE_CACHE_VALUE;
        entries.push([key, safe]);
      }
      return Object.freeze(Object.fromEntries(entries));
    } finally {
      ancestors.delete(value);
    }
  }

  private isCacheRecord(value: CacheKeyValue): value is Readonly<Record<string, CacheKeyValue>> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  private sha256(value: CacheKeyValue): string {
    const hash = createHash('sha256');
    const writeText = (marker: string, text: string): void => {
      hash.update(marker);
      hash.update(String(Buffer.byteLength(text, 'utf8')));
      hash.update(':');
      hash.update(text, 'utf8');
    };
    const visit = (entry: CacheKeyValue): void => {
      if (entry === undefined) return void hash.update('u;');
      if (entry === null) return void hash.update('n;');
      if (typeof entry === 'string') return writeText('s', entry);
      if (typeof entry === 'number') return writeText('d', Object.is(entry, -0) ? '-0' : String(entry));
      if (typeof entry === 'boolean') return void hash.update(entry ? 'b1;' : 'b0;');
      if (Array.isArray(entry)) {
        hash.update(`a${entry.length}[`);
        for (const item of entry) visit(item);
        hash.update(']');
        return;
      }
      const record = entry as Readonly<Record<string, CacheKeyValue>>;
      const keys = Object.keys(record).sort();
      hash.update(`o${keys.length}{`);
      for (const key of keys) {
        writeText('k', key);
        visit(record[key]);
      }
      hash.update('}');
    };
    visit(value);
    return hash.digest('hex');
  }
}
