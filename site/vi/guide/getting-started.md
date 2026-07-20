# Bắt đầu {#getting-started}

Hướng dẫn này khởi động hạ tầng dùng chung, thiết lập danh tính đã xác minh, giới hạn phạm vi repository TypeORM
và cài đặt response caching. Hãy đọc [Cài đặt](/vi/guide/installation) trước.

## Module gốc {#root-module}

```ts
import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SdCoreModule } from '@sdcorejs/nestjs';
import { CacheInterceptor } from '@sdcorejs/nestjs/services';
import { z } from 'zod';

const AccessTokenClaimsSchema = z.object({
  sub: z.string().min(1),
  tenant: z.string().min(1).max(64),
  roles: z.array(z.string().min(1)).optional(),
});

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const jwtSecret = requiredEnv('JWT_SECRET');
const jwtIssuer = requiredEnv('JWT_ISSUER');
const jwtAudience = requiredEnv('JWT_AUDIENCE');

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.DATABASE_URL,
      autoLoadEntities: true,
      synchronize: false,
    }),
    ScheduleModule.forRoot(),
    SdCoreModule.forRoot({
      context: {
        identity: {
          principalResolver: (principal: unknown) => {
            const claims = AccessTokenClaimsSchema.parse(principal);
            return {
              userId: claims.sub,
              tenant: claims.tenant,
              roles: claims.roles,
            };
          },
        },
      },
      tenancy: {
        resolve: (context) => ({ tenantCode: context.tenant }),
      },
      jwt: { secret: jwtSecret, issuer: jwtIssuer, audience: jwtAudience },
      cache: { backend: 'memory', ttl: 60, maxEntries: 1_000 },
      http: { timeout: 10_000, trustedOrigins: [] },
      i18n: {
        supportedLanguages: ['en', 'vi'],
        fallbackLanguage: 'en',
      },
    }),
  ],
  providers: [
    { provide: APP_INTERCEPTOR, useExisting: CacheInterceptor },
  ],
})
export class AppModule {}
```

Trong môi trường triển khai, hãy dùng migration đã được review thay cho `synchronize: true`. Provider của cache
interceptor là bắt buộc; `@Cached()` chỉ là metadata cho đến khi một interceptor được cài đặt.

## Thêm entity có phạm vi {#add-a-scoped-entity}

```ts
import { Column, Entity, Index } from 'typeorm';
import {
  BaseEntity,
  Scoped,
  SearchableFields,
  WithAudit,
} from '@sdcorejs/nestjs/core';

@SearchableFields({ exact: ['sku'], contain: ['name'] })
@Entity('product')
@Index(['tenantCode', 'sku'], { unique: true })
export class Product extends WithAudit(BaseEntity) {
  @Column() @Scoped() tenantCode!: string;
  @Column() sku!: string;
  @Column() name!: string;
}
```

Mọi thao tác đọc và thay đổi của `BaseRepository<Product>` giờ đều cần một `tenantCode` hợp lệ từ tenancy
strategy. Create/import điền giá trị này từ context; update thông thường không thể thay đổi nó.

## Chọn ví dụ tiếp theo {#choose-the-next-example}

- [Ứng dụng hoàn chỉnh](/vi/examples/complete-app) kết nối entity, repository, service, controller,
  xác thực và kiểm thử.
- [CRUD theo tenant](/vi/examples/tenant-crud) tập trung vào stack ORM cơ sở.
- [Danh tính và permission](/vi/examples/identity-and-permissions) cấu hình Keycloak/JWT và phân quyền route.
- [Cache và HTTP](/vi/examples/cache-and-http) trình bày namespace cache và truyền dữ liệu outbound đáng tin cậy.

## Trước khi đưa lên production {#before-production}

1. Làm theo [migration 1.0 → 1.1](/vi/migrations/1.0-to-1.1).
2. Xác nhận yêu cầu PostgreSQL trong [Cơ sở dữ liệu](/vi/guide/database).
3. Dùng JWKS issuer policy tường minh hoặc symmetric secret mạnh.
4. Không bao giờ chấp nhận header danh tính nếu không có [ranh giới gateway](/vi/guide/trusted-gateway) đã xác minh.
5. Áp dụng xác thực, permission, validation và policy cấp tài nguyên cho mọi public route.
6. Chạy các gate build unit, integration, E2E, package và tài liệu.
