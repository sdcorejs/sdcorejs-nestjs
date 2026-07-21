# Cấu hình {#configuration}

`SdCoreModule.forRoot()` là API thành phần gốc. Gọi API này một lần ở root của ứng dụng, trừ khi
hướng dẫn tính năng trình bày rõ một cách import module độc lập.

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SdCoreModule } from '@sdcorejs/nestjs';
import { z } from 'zod';

const PrincipalSchema = z.object({
  sub: z.string().min(1),
  tenant: z.string().min(1).max(64),
  roles: z.array(z.string().min(1)).optional(),
});

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.DATABASE_URL,
      autoLoadEntities: true,
      synchronize: false,
    }),
    SdCoreModule.forRoot({
      context: {
        identity: {
          principalResolver: (principal: unknown) => {
            const claims = PrincipalSchema.parse(principal);
            return {
              userId: claims.sub,
              tenant: claims.tenant,
              roles: claims.roles,
            };
          },
        },
      },
      tenancy: {
        resolve: (ctx) => ({ tenantCode: ctx.tenant }),
      },
      cache: { backend: 'memory', ttl: 60, maxEntries: 1_000 },
      http: { timeout: 10_000, trustedOrigins: [] },
    }),
  ],
})
export class AppModule {}
```

## Các module luôn bật {#always-on-modules}

Các khóa này là tùy chọn vì mỗi module đều có giá trị mặc định, nhưng các module luôn được ghép vào:

| Khóa | Mục đích | Giá trị mặc định quan trọng |
| --- | --- | --- |
| `context` | request context bằng AsyncLocalStorage | không tin cậy header danh tính |
| `tenancy` | scope strategy hoặc callback | entity có phạm vi fail-closed |
| `audit` | strategy cho trường kiểm toán | chỉ điền ID khi có user đã xác minh |
| `permission` | permission strategy | không có permission |
| `cache` | cache memory hoặc Redis | memory trong tiến trình, TTL 60 giây |
| `http` | client dựa trên Axios | không truyền danh tính |

## Các module bật theo nhu cầu {#opt-in-modules}

Các module này chỉ được đăng ký khi có khóa tương ứng:

| Khóa | Bật | Hạ tầng bổ sung |
| --- | --- | --- |
| `jwt` | Passport strategy JWT đối xứng hoặc JWKS/OIDC | secret hoặc issuer policy tường minh |
| `i18n` | catalog và exception filter | resolver tùy chỉnh không bắt buộc |
| `uploadedFile` | lưu file local/S3 | entity TypeORM; scheduler để dọn dẹp |
| `actionHistory` | lịch sử kiểm toán trước/sau | entity TypeORM và policy đọc |
| `jobScheduler` | lease cơ sở dữ liệu phân tán | entity PostgreSQL và unique index |
| `queue` | kết nối và giá trị mặc định BullMQ | Redis |

Khi bật `uploadedFile`, `actionHistory` hoặc `jobScheduler`, hãy giữ
`autoLoadEntities: true` hoặc liệt kê tường minh `UploadedFile`, `ActionHistory` và `JobScheduler` trong
data source TypeORM. Dùng migration trong production; không phụ thuộc vào `synchronize: true`.

## Provider mở rộng {#extension-providers}

Mảng `providers` đăng ký và re-export các implementation của ứng dụng cho public DI token:

```ts
import { SdCoreModule, INTERNAL_SECRET_PROVIDER } from '@sdcorejs/nestjs';

SdCoreModule.forRoot({
  providers: [
    {
      provide: INTERNAL_SECRET_PROVIDER,
      useFactory: () => ({
        getKeys: () => [
          process.env.INTERNAL_SECRET_CURRENT,
          process.env.INTERNAL_SECRET_NEXT,
        ].filter((value): value is string => Boolean(value)),
        getKey: () => process.env.INTERNAL_SECRET_CURRENT ?? '',
      }),
    },
  ],
});
```

Đối với secret provider tích hợp dựa trên biến môi trường, dùng dạng ngắn hơn:

```ts
SdCoreModule.forRoot({
  internalSecret: { envVar: 'INTERNAL_SECRET_KEY' },
});
```

Dạng literal `{ key: '...' }` đã deprecated và chỉ phù hợp cho test cô lập.

## Checklist cấu hình {#configuration-checklist}

1. Thiết lập danh tính từ JWT đã xác minh hoặc gateway được xác minh tường minh.
2. Trả về mọi giá trị `@Scoped()` bắt buộc từ tenancy policy.
3. Đăng ký `CacheInterceptor` trước khi mong đợi `@Cached()` chạy.
4. Dùng origin đáng tin cậy chính xác để truyền danh tính outbound.
5. Đăng ký entity cơ sở dữ liệu và migration cho các tính năng có trạng thái đã bật.
6. Chỉ gắn feature controller khi ứng dụng chủ động muốn cung cấp route của chúng.
