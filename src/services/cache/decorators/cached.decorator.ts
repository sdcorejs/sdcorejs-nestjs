import 'reflect-metadata';
import type { CacheKeyResolver, CacheScope } from '../types';

export interface CachedOptions {
  /**
   * Mandatory cache isolation boundary. Tenant/user scopes bypass caching when their required
   * context values are unavailable; they never fall back to a shared anonymous key.
   */
  scope: CacheScope;
  /** TTL in seconds. Default: 60. Use 0 for no expiry. */
  ttl?: number;
  /**
   * Select JSON-safe business-key material from a normalized HTTP request. This is a breaking
   * replacement for the old `(methodName, args)` callback: raw Nest transport arguments are never
   * exposed. The result is SHA-256 hashed and cannot bypass the mandatory security namespace.
   */
  keyResolver?: CacheKeyResolver;
}

export const CACHED_METADATA = 'sdcore:cache:cached';

/**
 * Method decorator that caches a controller handler's response. `CacheInterceptor` computes a
 * mandatory class/method + security namespace and returns the cached value on subsequent calls.
 *
 * **Constraints:**
 * - Only for **single-value (request/response) handlers**: the interceptor uses `firstValueFrom`
 *   internally, so multi-emit Observables are not supported.
 * - Handlers that complete without emitting throw `EmptyError`; do not apply this decorator to
 *   endpoints that may return nothing.
 * - `undefined` is never cached, so a handler returning `undefined` is always called.
 * - Concurrent requests for the same fully namespaced key share one handler invocation through
 *   `CacheService.load`.
 * - Only HTTP execution contexts with JSON-safe params/query/body are cached. Other transports or
 *   unsupported/circular values bypass caching instead of sharing an unsafe fallback key.
 *
 * **Key resolution:** `<ClassName>.<method>:<scopeHash>:<businessHash>`. `scope` is required.
 * Every non-global scope automatically fingerprints all JSON-safe request-context security/domain
 * fields, including `custom` and consumer declaration-merged fields. Runtime `request`, `response`,
 * `token`, and `user` references are excluded; tenant scope also omits `userId` to preserve explicit
 * tenant-wide sharing. Roles and permissions are order-independent. Unsafe/circular context values
 * bypass caching. Override `keyResolver` only to choose the business-key suffix; it cannot bypass
 * this security namespace.
 *
 * @example
 * // Cache for two minutes; key includes the normalized HTTP request descriptor by default.
 * @Get('products')
 * @Cached({ scope: 'global', ttl: 120 })
 * listAll(@Query() query: ProductQuery) { ... }
 *
 * @example
 * // Custom business suffix; mandatory tenant isolation remains in the namespace.
 * @Get('reports')
 * @Cached({ scope: 'tenant', ttl: 300, keyResolver: ({ params, query }) => ({ reportId: params.id, page: query.page }) })
 * reports(@Query() query: ReportQuery) { ... }
 */
export function Cached(options: CachedOptions): MethodDecorator {
  return (target, propertyKey, descriptor) => {
    Reflect.defineMetadata(CACHED_METADATA, options, target, propertyKey);
    return descriptor;
  };
}
