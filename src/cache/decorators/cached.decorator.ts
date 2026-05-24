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
 * Method decorator that attaches caching metadata. `CacheInterceptor` reads it at runtime,
 * computes a key from `<className>.<method>:<argsHash>`, and short-circuits subsequent calls
 * within the TTL window.
 *
 * @example
 * class ProductService {
 *   @Cached({ ttl: 120 })
 *   listAll() { ... }
 * }
 */
export function Cached(options: CachedOptions = {}): MethodDecorator {
  return (target, propertyKey, descriptor) => {
    Reflect.defineMetadata(CACHED_METADATA, options, target, propertyKey);
    return descriptor;
  };
}
