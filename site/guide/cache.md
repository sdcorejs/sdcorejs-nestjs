# Cache

The cache layer has two APIs: `CacheService` for explicit cache-aside operations, and
`@Cached()` plus `CacheInterceptor` for HTTP controller responses.

## Register the interceptor

`SdCoreModule` provides `CacheInterceptor`, but it does not install it globally. Registration is
mandatory before `@Cached()` has any effect:

```ts
import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { SdCoreModule } from '@sdcorejs/nestjs';
import { CacheInterceptor } from '@sdcorejs/nestjs/services';

@Module({
  imports: [
    SdCoreModule.forRoot({
      cache: { backend: 'memory', ttl: 60, maxEntries: 1_000 },
    }),
  ],
  providers: [
    { provide: APP_INTERCEPTOR, useExisting: CacheInterceptor },
  ],
})
export class AppModule {}
```

Alternatively, apply `@UseInterceptors(CacheInterceptor)` to specific controllers.

## Safe cache scopes

```ts
import { Controller, Get, Query } from '@nestjs/common';
import { Cached } from '@sdcorejs/nestjs/services';

@Controller('catalog')
class CatalogController {
  @Get('public-countries')
  @Cached({ scope: 'global', ttl: 3_600 })
  countries() {
    return ['VN', 'SG'];
  }

  @Get('products')
  @Cached({
    scope: 'tenant',
    ttl: 60,
    keyResolver: ({ query }) => ({ page: query.page, q: query.q }),
  })
  products(@Query() query: Record<string, string>) {
    return { query };
  }
}
```

| Scope | Mandatory namespace | Missing/unsafe context |
| --- | --- | --- |
| `global` | class, method, explicit global marker | caches |
| `tenant` | tenant and safe domain/security context except user ID | bypasses cache |
| `user` | tenant, user, and safe domain/security context | bypasses cache |

`global` is only for output identical across every tenant, user, language, role, permission, and
domain context. Tenant/user namespaces include JSON-safe custom context fields. Unsafe, circular,
accessor-based, or excessively deep context/input makes the interceptor bypass caching.

A custom `keyResolver` receives only normalized method, URL, path, params, query, and body. It
chooses the business suffix but cannot remove the mandatory security namespace.

`@Cached()` supports single-value HTTP handlers. `undefined` is not cached, empty streams fail,
and multi-emission Observables are not supported. Concurrent misses for one complete key share one
handler execution.

## Explicit cache service

```ts
import { Injectable } from '@nestjs/common';
import { CacheService } from '@sdcorejs/nestjs/services';

@Injectable()
class ExchangeRateService {
  constructor(private readonly cache: CacheService) {}

  getRate(pair: string) {
    return this.cache.load(
      'fx:' + pair,
      async () => ({ pair, rate: 1 }),
      30,
    );
  }
}
```

Available operations are `get`, `set`, `del`, `clear`, `size`, and `load`. Backend errors
and configured timeouts degrade to a safe miss/no-op; warnings make degradation observable.
`load()` deduplicates concurrent factories by key. When using it directly, key tenancy is your
responsibility.

## Redis

```ts
import { SdCoreModule } from '@sdcorejs/nestjs';

SdCoreModule.forRoot({
  cache: {
    backend: 'redis',
    ttl: 300,
    fallbackToMemory: false,
    operationTimeoutMs: 1_000,
    redis: {
      host: 'redis.internal',
      port: 6379,
      keyPrefix: 'orders:prod:v3:',
    },
  },
});
```

`keyPrefix` is required, nonblank, and cannot contain Redis glob characters. `clear()` and
`size()` scan only that prefix; they never flush the database. Give each application, environment,
and key-contract version a different prefix.

The default Redis-construction fallback is memory. Consider `fallbackToMemory: false` when
cross-instance cache consistency is part of application behavior.
