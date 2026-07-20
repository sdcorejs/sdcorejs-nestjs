# Services API

Import path: `@sdcorejs/nestjs/services`

This entrypoint provides two infrastructure services:

- [Cache](./cache.md) — memory/Redis backends, resilient cache-aside service and scoped handler
  caching.
- [HTTP client](./http.md) — Axios methods with exact-origin context-header propagation and
  redirect revalidation.

```ts
import {
  CacheService,
  HttpService,
  type CacheConfig,
  type HttpClientConfig,
} from '@sdcorejs/nestjs/services';
```

Both modules are global after `forRoot`, including when composed by `SdCoreModule`. Caching is
fail-soft at the backend boundary. Identity propagation is fail-closed: no origin is trusted by
default, configured identity headers are stripped from untrusted destinations, and every redirect
is evaluated again.

::: warning Cache interceptor registration
`@Cached()` requires `CacheInterceptor` on the handler/controller or an `APP_INTERCEPTOR`
registration. Providing `CacheModule` alone does not execute decorator behavior.
:::
