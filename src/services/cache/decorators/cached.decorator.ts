import 'reflect-metadata';

export interface CachedOptions {
  /** TTL in seconds. Default: 60. Use 0 for no expiry. */
  ttl?: number;
  /** Build a custom cache key from `(methodName, args)`. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  keyResolver?: (methodName: string, args: any[]) => string;
}

export const CACHED_METADATA = 'sdcore:cache:cached';

/**
 * Method decorator that caches a controller handler's response. `CacheInterceptor` reads the
 * metadata at runtime, computes a key from `<ClassName>.<method>:<argsHash>`, and returns the
 * cached value on subsequent calls within the TTL window.
 *
 * **Constraints:**
 * - Only for **single-value (request/response) handlers** — the interceptor uses `firstValueFrom`
 *   internally, so multi-emit Observables are not supported (only the first emission is returned).
 * - Handlers that complete without emitting throw `EmptyError` at the interceptor level; do not
 *   apply this to endpoints that may return nothing.
 * - `undefined` is never cached — a handler that returns `undefined` is always called (soft miss).
 * - Concurrent requests for the same key share one handler invocation (stampede protection via
 *   `CacheService.load`). This is key-only dedup — keys registered with different `keyResolver`
 *   logic that resolve to the same string will collapse.
 *
 * **Key resolution** (default): `<ClassName>.<method>:<sha256(JSON.stringify(args))>`.
 * Override with `keyResolver` for fine-grained control (e.g. ignore auth headers, include
 * tenant-code, hash only the page/size fields of a paging request).
 *
 * @example
 * // Cache for 2 minutes; key includes all args by default.
 * @Get('products')
 * @Cached({ ttl: 120 })
 * listAll(@Query() q: ProductQuery) { ... }
 *
 * @example
 * // Custom key — ignore volatile auth fields, scope by tenant.
 * @Get('reports')
 * @Cached({ ttl: 300, keyResolver: (method, [q]) => `${method}:${q.tenantCode}:${q.page}` })
 * reports(@Query() q: ReportQuery) { ... }
 */
export function Cached(options: CachedOptions = {}): MethodDecorator {
  return (target, propertyKey, descriptor) => {
    Reflect.defineMetadata(CACHED_METADATA, options, target, propertyKey);
    return descriptor;
  };
}
