# Cache API

Import path: `@sdcorejs/nestjs/services`

The cache package provides an in-process LRU backend, an optional Redis backend, a resilient
cache-aside service and a security-scoped HTTP handler decorator/interceptor.

## Exports

| Export | Kind | Purpose |
| --- | --- | --- |
| `CacheBackend` | interface | Async `get`, `set`, `del`, `clear`, `size` contract |
| `MemoryCacheBackend` | class | Bounded in-process LRU with per-entry TTL |
| `RedisCacheBackend` | class | JSON-serialized Redis backend with prefix-scoped scans |
| `InvalidRedisCacheKeyPrefixError` | class | Unsafe/missing Redis namespace error |
| `CacheService` | class | Resilient DI-facing backend and cache-aside API |
| `CacheModule` | class | Global provider module; `forRoot(config?)` |
| `CacheConfig`, `MemoryCacheConfig`, `RedisCacheConfig`, `RedisCacheOptions` | types | Backend configuration contracts |
| `CacheBackendKind` | type | `'memory' \| 'redis'` |
| `CACHE_CONFIG` | value | Resolved config DI token |
| `Cached`, `CachedOptions` | decorator/type | Marks a handler with mandatory cache scope |
| `CACHED_METADATA` | value | Decorator metadata key |
| `CacheScope` | type | `'global' \| 'tenant' \| 'user'` |
| `CacheKeyValue`, `CacheKeyResolver` | types | JSON-safe business-key material and selector |
| `CacheHttpRequestDescriptor` | interface | Normalized method/URL/path/params/query/body key input |
| `CacheInterceptor` | class | Executes `@Cached` behavior; must be registered explicitly |
| `RequestCacheMiddleware` | class | Adds a fresh `requestCache: Map` to each request |

## Configure the backend

```ts
CacheModule.forRoot({
  backend: 'memory',
  ttl: 60,
  maxEntries: 1_000,
  operationTimeoutMs: 1_000,
});
```

```ts
CacheModule.forRoot({
  backend: 'redis',
  ttl: 300,
  operationTimeoutMs: 1_000,
  fallbackToMemory: false,
  redis: {
    host: 'redis.internal.example',
    port: 6379,
    db: 2,
    keyPrefix: 'orders:cache:',
  },
});
```

| Option | Default | Notes |
| --- | --- | --- |
| `backend` | `'memory'` | Redis requires `redis` options and runtime `ioredis` |
| `ttl` | `60` seconds | `0` disables expiration |
| `maxEntries` | `1000` | Memory only; oldest-touched entry is evicted |
| `fallbackToMemory` | `true` | Redis construction failure only; invalid prefix still throws |
| `operationTimeoutMs` | `1000` | `0` disables timeout |
| `redis.keyPrefix` | required | Nonblank; cannot contain `*`, `?`, `[`, `]`, or `\` |

Redis `clear()` and `size()` use `SCAN MATCH <keyPrefix>*`; they never call `FLUSHDB`. Use a unique
application/environment prefix. Values must be JSON-serializable.

## `CacheService`

```ts
const order = await cache.load(
  `order:${orderId}`,
  () => repository.findOneByOrFail({ id: orderId }),
  120,
);

await cache.set('catalog:version', 42, 0);
await cache.del(`order:${orderId}`);
```

| Member | Signature / behavior |
| --- | --- |
| `backendKind` | Resolved `'memory'` or `'redis'`, including fallback |
| `get<T>` | `(key) => Promise<T \| undefined>`; concurrent reads share one backend call |
| `set<T>` | `(key, value, ttlSec?) => Promise<void>` |
| `del` | `(key) => Promise<void>` |
| `clear` | `() => Promise<void>` |
| `size` | `() => Promise<number>` |
| `load<T>` | `(key, factory, ttlSec?) => Promise<T>`; concurrent misses share one factory |

Backend errors and timeouts are logged and degrade to miss/no-op/zero. Factory errors from `load`
are not swallowed. `undefined` factory results are never cached. Single-flight locks are keyed only
by `key`, so do not use different factories for the same key.

## Register `CacheInterceptor`

`CacheModule` registers and exports `CacheInterceptor`, but intentionally does **not** apply it.
Without one of the registrations below, `@Cached()` is metadata only and the handler always runs.

Per controller or handler:

```ts
@UseInterceptors(CacheInterceptor)
@Controller('reports')
export class ReportsController {}
```

Global:

```ts
@Module({
  providers: [
    { provide: APP_INTERCEPTOR, useExisting: CacheInterceptor },
  ],
})
export class AppModule {}
```

## `@Cached` scopes and keys

```ts
@Get(':id')
@Cached({
  scope: 'tenant',
  ttl: 120,
  keyResolver: ({ params, query }) => ({ id: params.id, locale: query.locale }),
})
detail() {}
```

`CachedOptions.scope` is required:

| Scope | Required context | Isolation material |
| --- | --- | --- |
| `global` | none | Explicit global namespace only |
| `tenant` | non-empty `tenant` | Every JSON-safe context field except request/response/token/user and `userId` |
| `user` | non-empty `tenant` and `userId` | Every JSON-safe context field except request/response/token/user |

Roles and permissions are sorted before hashing. Custom and declaration-merged context fields are
included. Missing identity, circular/unsafe values, unsupported transports or an exception in
`keyResolver` cause a cache bypass, never a shared fallback key.

The final key is `<Class>.<method>:<scopeHash>:<businessHash>`. By default, business material is a
normalized HTTP descriptor containing method, URL, path, params, query and body. Headers and raw
Nest request/response objects are excluded. A custom resolver selects only the business suffix and
cannot remove the mandatory scope namespace.

`@Cached` supports single-value request/response handlers. It uses the first Observable emission;
multi-emission streams are unsupported, handlers that emit nothing fail with RxJS `EmptyError`, and
`undefined` is not cached.

::: warning Global scope
Use `scope: 'global'` only when the response is identical for every tenant, user, role and
permission set. The interceptor cannot infer whether application data is safe to share globally.
:::

## Request-local cache

`RequestCacheMiddleware` only creates the map; apply it through your own `NestModule.configure`:

```ts
configure(consumer: MiddlewareConsumer): void {
  consumer.apply(RequestCacheMiddleware).forRoutes('*');
}
```

This map is not a replacement for authorization checks and disappears after the request.
