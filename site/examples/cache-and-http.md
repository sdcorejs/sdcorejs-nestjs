# Cache and outbound HTTP

This recipe caches tenant-scoped catalog responses and propagates tenant identity only to one exact
internal origin.

Merge this focused configuration with the verified JWT or trusted-gateway identity setup from
[Identity and permissions](/examples/identity-and-permissions). Without a trusted tenant in request
context, tenant-scoped handlers deliberately bypass the cache and no identity headers propagate.

## Module setup

```ts
import { Injectable, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { SdCoreModule } from '@sdcorejs/nestjs';
import {
  CacheInterceptor,
  HttpService,
} from '@sdcorejs/nestjs/services';

@Injectable()
class InventoryClient {
  constructor(private readonly http: HttpService) {}

  availability(productId: string) {
    return this.http.get<{ available: boolean }>(
      '/availability/' + encodeURIComponent(productId),
    );
  }
}

@Module({
  imports: [
    SdCoreModule.forRoot({
      cache: {
        backend: 'redis',
        ttl: 60,
        fallbackToMemory: false,
        redis: {
          host: process.env.REDIS_HOST ?? 'localhost',
          port: Number(process.env.REDIS_PORT ?? 6379),
          keyPrefix: 'catalog:prod:v2:',
        },
      },
      http: {
        baseURL: 'https://inventory.internal.example',
        trustedOrigins: ['https://inventory.internal.example'],
        timeout: 5_000,
      },
    }),
  ],
  providers: [
    { provide: APP_INTERCEPTOR, useExisting: CacheInterceptor },
    InventoryClient,
  ],
})
export class AppModule {}
```

Registering `APP_INTERCEPTOR` is mandatory. Without it, `@Cached()` only attaches metadata and
handlers execute normally on every request.

## Tenant response cache

```ts
import { Controller, Get, Query } from '@nestjs/common';
import { Cached } from '@sdcorejs/nestjs/services';

@Controller('catalog')
class CatalogController {
  @Get('search')
  @Cached({
    scope: 'tenant',
    ttl: 30,
    keyResolver: ({ query }) => ({
      q: query.q,
      page: query.page,
    }),
  })
  search(@Query() query: { q?: string; page?: string }) {
    return {
      q: query.q ?? '',
      page: Number(query.page ?? 0),
    };
  }
}
```

The business suffix uses query values, but the interceptor still adds class/method and a mandatory
tenant/domain/security namespace. Missing tenant identity bypasses the cache; it never falls back to
an anonymous shared key.

Use `scope: 'user'` for user-private output. Use `scope: 'global'` only for output that is
identical across tenant, user, language, roles, permissions, and all domain context.

## Explicit cache invalidation

```ts
import { Injectable } from '@nestjs/common';
import { CacheService } from '@sdcorejs/nestjs/services';

@Injectable()
class ProductCache {
  constructor(private readonly cache: CacheService) {}

  detail(tenant: string, id: string, load: () => Promise<unknown>) {
    return this.cache.load('product:' + tenant + ':' + id, load, 60);
  }

  invalidate(tenant: string, id: string) {
    return this.cache.del('product:' + tenant + ':' + id);
  }
}
```

Direct keys are application-owned, so this example includes tenant explicitly.

## Propagation checks

For a request context containing tenant `ACME`:

- `http.get('/stock')` targets the configured base origin and receives generated `x-tenant: ACME`;
- `http.get('https://inventory.internal.example:8443/stock')` is a different origin and receives no
  identity headers;
- `http.get('https://external.example/stock')` receives no identity headers; and
- a redirect from the trusted origin to an external origin is stripped again.

The client does not generate `Authorization` or `x-internal-secret`. Caller-supplied internal
secrets survive only for an exact trusted origin.

## Tests to keep

1. Same query, same tenant → one handler execution across concurrent misses.
2. Same query, different tenant or permission version → different value at `scope: 'tenant'`.
3. Different `userId` alone shares the tenant-scoped value; `scope: 'user'` isolates per user.
4. Missing or unsafe context → handler runs and no shared cache hit occurs.
5. Trusted origin receives configured identity headers.
6. Lookalike host, alternate port, and untrusted redirect receive none.
