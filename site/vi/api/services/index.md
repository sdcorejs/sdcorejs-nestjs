# API service {#services-api}

Đường dẫn import: `@sdcorejs/nestjs/services`

Entrypoint này cung cấp hai service hạ tầng:

- [Cache](./cache.md) — backend memory/Redis, service cache-aside bền bỉ và cache handler có scope.
- [HTTP client](./http.md) — method Axios truyền context-header theo origin chính xác và validation
  lại redirect.

```ts
import {
  CacheService,
  HttpService,
  type CacheConfig,
  type HttpClientConfig,
} from '@sdcorejs/nestjs/services';
```

Cả hai module đều global sau `forRoot`, kể cả khi được `SdCoreModule` kết hợp. Caching là fail-soft
tại backend boundary. Truyền danh tính là fail-closed: mặc định không tin cậy origin nào, identity
header đã cấu hình bị loại khỏi đích không tin cậy và mỗi redirect được đánh giá lại.

::: warning Đăng ký cache interceptor
`@Cached()` yêu cầu `CacheInterceptor` trên handler/controller hoặc đăng ký `APP_INTERCEPTOR`. Chỉ
cung cấp `CacheModule` không thực thi hành vi decorator.
:::
