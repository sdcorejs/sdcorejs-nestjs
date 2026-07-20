# API cache {#cache-api}

Đường dẫn import: `@sdcorejs/nestjs/services`

Package cache cung cấp backend LRU trong process, backend Redis tùy chọn, service cache-aside bền bỉ
và decorator/interceptor HTTP handler có scope bảo mật.

## Các export {#exports}

| Export | Loại | Mục đích |
| --- | --- | --- |
| `CacheBackend` | interface | Contract async `get`, `set`, `del`, `clear`, `size` |
| `MemoryCacheBackend` | class | LRU trong process có giới hạn với TTL theo từng entry |
| `RedisCacheBackend` | class | Backend Redis serialize JSON với scan có scope theo prefix |
| `InvalidRedisCacheKeyPrefixError` | class | Lỗi namespace Redis không an toàn/bị thiếu |
| `CacheService` | class | API backend bền bỉ hướng DI và cache-aside |
| `CacheModule` | class | Module provider global; `forRoot(config?)` |
| `CacheConfig`, `MemoryCacheConfig`, `RedisCacheConfig`, `RedisCacheOptions` | type | Contract cấu hình backend |
| `CacheBackendKind` | type | `'memory' \| 'redis'` |
| `CACHE_CONFIG` | value | DI token cấu hình đã phân giải |
| `Cached`, `CachedOptions` | decorator/type | Đánh dấu handler với cache scope bắt buộc |
| `CACHED_METADATA` | value | Khóa metadata của decorator |
| `CacheScope` | type | `'global' \| 'tenant' \| 'user'` |
| `CacheKeyValue`, `CacheKeyResolver` | type | Vật liệu business-key an toàn với JSON và selector |
| `CacheHttpRequestDescriptor` | interface | Đầu vào key method/URL/path/params/query/body đã chuẩn hóa |
| `CacheInterceptor` | class | Thực thi hành vi `@Cached`; phải đăng ký rõ ràng |
| `RequestCacheMiddleware` | class | Thêm `requestCache: Map` mới cho mỗi request |

## Cấu hình backend {#configure-the-backend}

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

| Option | Mặc định | Lưu ý |
| --- | --- | --- |
| `backend` | `'memory'` | Redis yêu cầu option `redis` và runtime `ioredis` |
| `ttl` | `60` giây | `0` tắt expiration |
| `maxEntries` | `1000` | Chỉ memory; entry được chạm lâu nhất sẽ bị evict |
| `fallbackToMemory` | `true` | Chỉ khi khởi tạo Redis thất bại; prefix không hợp lệ vẫn ném lỗi |
| `operationTimeoutMs` | `1000` | `0` tắt timeout |
| `redis.keyPrefix` | bắt buộc | Không rỗng; không thể chứa `*`, `?`, `[`, `]` hoặc `\` |

`clear()` và `size()` của Redis dùng `SCAN MATCH <keyPrefix>*`; chúng không bao giờ gọi `FLUSHDB`.
Dùng prefix riêng cho từng ứng dụng/môi trường. Giá trị phải có thể serialize JSON.

## `CacheService` {#cacheservice}

```ts
const order = await cache.load(
  `order:${orderId}`,
  () => repository.findOneByOrFail({ id: orderId }),
  120,
);

await cache.set('catalog:version', 42, 0);
await cache.del(`order:${orderId}`);
```

| Thành viên | Signature / hành vi |
| --- | --- |
| `backendKind` | `'memory'` hoặc `'redis'` đã phân giải, bao gồm fallback |
| `get<T>` | `(key) => Promise<T \| undefined>`; đọc đồng thời dùng chung một lời gọi backend |
| `set<T>` | `(key, value, ttlSec?) => Promise<void>` |
| `del` | `(key) => Promise<void>` |
| `clear` | `() => Promise<void>` |
| `size` | `() => Promise<number>` |
| `load<T>` | `(key, factory, ttlSec?) => Promise<T>`; miss đồng thời dùng chung một factory |

Lỗi và timeout backend được log rồi suy giảm thành miss/no-op/zero. Lỗi factory từ `load` không bị
nuốt. Kết quả factory `undefined` không bao giờ được cache. Khóa single-flight chỉ theo `key`, vì
vậy không dùng factory khác nhau cho cùng key.

## Đăng ký `CacheInterceptor` {#register-cacheinterceptor}

`CacheModule` đăng ký và export `CacheInterceptor`, nhưng chủ ý **không** áp dụng nó. Nếu không có
một trong các đăng ký dưới đây, `@Cached()` chỉ là metadata và handler luôn chạy.

Theo controller hoặc handler:

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

## Scope và key của `@Cached` {#cached-scopes-and-keys}

```ts
@Get(':id')
@Cached({
  scope: 'tenant',
  ttl: 120,
  keyResolver: ({ params, query }) => ({ id: params.id, locale: query.locale }),
})
detail() {}
```

`CachedOptions.scope` là bắt buộc:

| Scope | Context bắt buộc | Vật liệu isolation |
| --- | --- | --- |
| `global` | không | Chỉ namespace global rõ ràng |
| `tenant` | `tenant` không rỗng | Mọi trường context an toàn với JSON trừ request/response/token/user và `userId` |
| `user` | `tenant` và `userId` không rỗng | Mọi trường context an toàn với JSON trừ request/response/token/user |

Role và permission được sắp xếp trước khi hash. Các trường context tùy chỉnh và declaration-merged
được bao gồm. Thiếu danh tính, giá trị vòng/không an toàn, transport không được hỗ trợ hoặc exception
trong `keyResolver` sẽ bypass cache, không bao giờ tạo shared fallback key.

Key cuối cùng là `<Class>.<method>:<scopeHash>:<businessHash>`. Theo mặc định, vật liệu business là
HTTP descriptor đã chuẩn hóa gồm method, URL, path, params, query và body. Header và object
request/response Nest thô bị loại trừ. Resolver tùy chỉnh chỉ chọn suffix business và không thể bỏ
namespace scope bắt buộc.

`@Cached` hỗ trợ handler request/response một giá trị. Nó dùng emission Observable đầu tiên; stream
nhiều emission không được hỗ trợ, handler không emit gì fail với RxJS `EmptyError`, và `undefined`
không được cache.

::: warning Global scope
Chỉ dùng `scope: 'global'` khi response giống hệt nhau cho mọi tenant, user, role và tập permission.
Interceptor không thể suy ra dữ liệu ứng dụng có an toàn để chia sẻ global hay không.
:::

## Cache cục bộ theo request {#request-local-cache}

`RequestCacheMiddleware` chỉ tạo map; hãy áp dụng nó qua `NestModule.configure` của bạn:

```ts
configure(consumer: MiddlewareConsumer): void {
  consumer.apply(RequestCacheMiddleware).forRoutes('*');
}
```

Map này không thay thế kiểm tra authorization và biến mất sau request.
