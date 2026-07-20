# Hướng dẫn ứng dụng hoàn chỉnh {#complete-application-walkthrough}

Service nhỏ này cung cấp paging/search/detail/delete sản phẩm đã xác thực và có scope tenant, đồng
thời ghi lại lịch sử repository. Các snippet tạo thành một ứng dụng; comment file cho biết vị trí
của chúng.

## 1. Entity {#_1-entity}

```ts
// product.entity.ts
import { Column, Entity, Index } from 'typeorm';
import {
  BaseEntity,
  Scoped,
  SearchableFields,
  WithAudit,
} from '@sdcorejs/nestjs/core';

@SearchableFields({ exact: ['sku'], contain: ['name'], activeColumn: 'isActive' })
@Entity('product')
@Index(['tenantCode', 'sku'], { unique: true })
export class Product extends WithAudit(BaseEntity) {
  @Column() @Scoped() tenantCode!: string;
  @Column({ length: 64 }) sku!: string;
  @Column() name!: string;
  @Column({ default: true }) isActive!: boolean;
}
```

Bật extension `unaccent` của PostgreSQL trước khi dùng tìm kiếm contains.

## 2. Repository và service {#_2-repository-and-service}

```ts
// product.data.ts
import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  AUDIT_STRATEGY,
  BaseRepository,
  BaseService,
  ContextService,
  TENANCY_STRATEGY,
  type Dto,
  type IAuditStrategy,
  type ITenancyStrategy,
} from '@sdcorejs/nestjs/core';
import { Product } from './product.entity';

@Injectable()
export class ProductRepository extends BaseRepository<Product> {
  constructor(
    dataSource: DataSource,
    context: ContextService,
    @Inject(TENANCY_STRATEGY) tenancy: ITenancyStrategy,
    @Inject(AUDIT_STRATEGY) audit: IAuditStrategy,
  ) {
    super(Product, dataSource, {
      contextService: context,
      tenancyStrategy: tenancy,
      auditStrategy: audit,
      logHistory: true,
    });
  }
}

export interface ProductDto extends Dto {
  sku: string;
  name: string;
}

@Injectable()
export class ProductService extends BaseService<Product, ProductDto> {
  constructor(repository: ProductRepository) {
    super(repository);
  }

  mapDTO(entity: Product | undefined | null): ProductDto | null {
    if (!entity) return null;
    return {
      id: entity.id,
      sku: entity.sku,
      name: entity.name,
      deletable: true,
      restorable: Boolean(entity.deletedAt),
    };
  }
}
```

## 3. Controller và feature module {#_3-controller-and-feature-module}

```ts
// product.module.ts
import { Controller, Module, UseGuards } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthGuard, HasPermission } from '@sdcorejs/nestjs/auth';
import { BaseController } from '@sdcorejs/nestjs/core';
import { Product } from './product.entity';
import {
  ProductRepository,
  ProductService,
  type ProductDto,
} from './product.data';

@Controller('products')
@UseGuards(AuthGuard)
@HasPermission('product:manage')
class ProductController extends BaseController<Product, ProductDto> {
  constructor(service: ProductService) {
    super(service);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([Product])],
  controllers: [ProductController],
  providers: [ProductRepository, ProductService],
})
export class ProductModule {}
```

Permission ở cấp class bảo vệ mọi route được kế thừa. Để dùng permission đọc/xóa khác nhau, hãy
override từng method kế thừa, thêm metadata handler và ủy quyền cho `super`.

## 4. Cấu hình root {#_4-root-configuration}

```ts
// app.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SdCoreModule } from '@sdcorejs/nestjs';
import { z } from 'zod';
import { ProductModule } from './product.module';

const ClaimsSchema = z.object({
  sub: z.uuid(),
  tenant: z.string().min(1).max(64),
  permissions: z.array(z.string().min(1)).optional(),
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
    SdCoreModule.forRoot({
      context: {
        identity: {
          principalResolver: (principal: unknown) => {
            const claims = ClaimsSchema.parse(principal);
            return {
              userId: claims.sub,
              tenant: claims.tenant,
              permissions: claims.permissions,
            };
          },
        },
      },
      tenancy: {
        resolve: (context) => ({ tenantCode: context.tenant }),
      },
      jwt: { secret: jwtSecret, issuer: jwtIssuer, audience: jwtAudience },
      actionHistory: {
        authorizeRead: ({ context, tenantCode }) =>
          context.tenant === tenantCode &&
          context.permissions?.includes('history:read') === true,
        redactFields: ['costPrice'],
      },
      i18n: {
        supportedLanguages: ['en', 'vi'],
        fallbackLanguage: 'en',
      },
    }),
    ProductModule,
  ],
})
export class AppModule {}
```

Tạo migration cho `Product` và entity `ActionHistory` được auto-load. Token production phải được
ký bằng issuer/secret đã cấu hình và chứa UUID `sub`, một tenant và `product:manage`.

## 5. Thử các route {#_5-exercise-the-routes}

```bash
curl -X POST http://localhost:3000/products/paging \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"pageNumber":0,"pageSize":20}'
```

`TOKEN` là test token do ứng dụng phát hành, không phải giá trị literal. Route kế thừa trả HTTP 201
với `{ data: { items, total } }`. Trang đầu tiên là 0 và thư viện giới hạn kích thước trang ở 200.

Các route kế thừa khác là:

- `POST /products/search?keyword=phone` → 201;
- `GET /products/:uuid` → 200; và
- `DELETE /products/:uuid` → 200 với `{ data: null }`.

Tiếp tục với [Kiểm thử](/vi/examples/testing) trước khi thêm mutation nghiệp vụ.
