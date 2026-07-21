# Cache {#cache}

Tầng cache có hai API: `CacheService` cho các thao tác cache-aside tường minh, và
`@Cached()` cùng `CacheInterceptor` cho response của HTTP controller.

## Đăng ký interceptor {#register-the-interceptor}

`SdCoreModule` cung cấp `CacheInterceptor`, nhưng không cài đặt nó ở phạm vi global. Việc đăng ký là
bắt buộc trước khi `@Cached()` có hiệu lực:

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

Ngoài ra, có thể áp dụng `@UseInterceptors(CacheInterceptor)` cho từng controller cụ thể.

## Phạm vi cache an toàn {#safe-cache-scopes}

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

| Phạm vi | Namespace bắt buộc | Ngữ cảnh bị thiếu/không an toàn |
| --- | --- | --- |
| `global` | class, method, dấu hiệu global tường minh | lưu cache |
| `tenant` | tenant và ngữ cảnh miền/bảo mật an toàn, ngoại trừ user ID | bỏ qua cache |
| `user` | tenant, user và ngữ cảnh miền/bảo mật an toàn | bỏ qua cache |

`global` chỉ dành cho output giống hệt nhau giữa mọi tenant, user, language, role, permission và
ngữ cảnh miền. Namespace tenant/user bao gồm các trường ngữ cảnh tùy chỉnh an toàn với JSON. Ngữ cảnh/input
không an toàn, dạng vòng, dựa trên accessor hoặc lồng quá sâu sẽ khiến interceptor bỏ qua cache.

Một `keyResolver` tùy chỉnh chỉ nhận method, URL, path, params, query và body đã chuẩn hóa. Nó
chọn hậu tố nghiệp vụ nhưng không thể loại bỏ namespace bảo mật bắt buộc.

`@Cached()` hỗ trợ HTTP handler trả về một giá trị. `undefined` không được lưu cache, stream rỗng sẽ thất bại,
và Observable phát nhiều giá trị không được hỗ trợ. Các cache miss đồng thời cho cùng một khóa hoàn chỉnh sẽ dùng chung
một lần thực thi handler.

## Dịch vụ cache tường minh {#explicit-cache-service}

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

Các thao tác có sẵn gồm `get`, `set`, `del`, `clear`, `size` và `load`. Lỗi backend
và timeout đã cấu hình được hạ cấp thành cache miss/no-op an toàn; warning giúp quan sát tình trạng suy giảm.
`load()` khử trùng lặp các factory đồng thời theo khóa. Khi dùng trực tiếp, bạn chịu trách nhiệm về tenancy
của khóa.

## Redis {#redis}

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

`keyPrefix` là bắt buộc, không được để trống và không được chứa ký tự glob của Redis. `clear()` và
`size()` chỉ quét prefix đó; chúng không bao giờ flush cơ sở dữ liệu. Hãy cấp một prefix khác nhau cho mỗi ứng dụng,
môi trường và phiên bản hợp đồng khóa.

Fallback mặc định khi không thể tạo Redis là memory. Cân nhắc `fallbackToMemory: false` khi
tính nhất quán cache giữa các instance là một phần trong hành vi ứng dụng.
