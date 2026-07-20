# Cache và HTTP đi {#cache-and-outbound-http}

Công thức này cache response catalog theo tenant và chỉ truyền danh tính tenant đến đúng một origin
nội bộ khớp chính xác.

Gộp cấu hình chuyên biệt này với thiết lập danh tính JWT đã xác minh hoặc trusted gateway từ
[Danh tính và permission](/vi/examples/identity-and-permissions). Nếu request context không có tenant
đáng tin cậy, handler có scope tenant sẽ chủ đích bỏ qua cache và không truyền identity header.

## Thiết lập module {#module-setup}

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

Đăng ký `APP_INTERCEPTOR` là bắt buộc. Nếu không có nó, `@Cached()` chỉ gắn metadata và handler vẫn
chạy bình thường trên mọi request.

## Cache response theo tenant {#tenant-response-cache}

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

Suffix nghiệp vụ dùng giá trị query, nhưng interceptor vẫn thêm class/method và namespace
tenant/domain/bảo mật bắt buộc. Thiếu danh tính tenant sẽ bỏ qua cache; hệ thống không bao giờ
fallback về shared key ẩn danh.

Dùng `scope: 'user'` cho đầu ra riêng của user. Chỉ dùng `scope: 'global'` cho đầu ra giống hệt giữa
tenant, user, ngôn ngữ, role, permission và mọi domain context.

## Vô hiệu hóa cache rõ ràng {#explicit-cache-invalidation}

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

Direct key thuộc về ứng dụng, vì vậy ví dụ này đưa tenant vào rõ ràng.

## Kiểm tra truyền context {#propagation-checks}

Với request context chứa tenant `ACME`:

- `http.get('/stock')` nhắm đến base origin đã cấu hình và nhận `x-tenant: ACME` được sinh ra;
- `http.get('https://inventory.internal.example:8443/stock')` là origin khác và không nhận identity
  header;
- `http.get('https://external.example/stock')` không nhận identity header; và
- redirect từ origin đáng tin cậy sang origin bên ngoài lại bị loại bỏ header.

Client không sinh `Authorization` hoặc `x-internal-secret`. Internal secret do caller cung cấp chỉ
được giữ lại cho origin đáng tin cậy khớp chính xác.

## Các test cần duy trì {#tests-to-keep}

1. Cùng query, cùng tenant → handler chỉ chạy một lần giữa các cache miss đồng thời.
2. Cùng query, khác tenant hoặc permission version → giá trị khác nhau tại `scope: 'tenant'`.
3. Chỉ khác `userId` vẫn dùng chung giá trị có scope tenant; `scope: 'user'` cô lập theo user.
4. Context thiếu hoặc không an toàn → handler chạy và không xảy ra shared cache hit.
5. Origin đáng tin cậy nhận identity header đã cấu hình.
6. Host gần giống, port khác và redirect không đáng tin cậy không nhận header nào.
