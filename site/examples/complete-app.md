# Complete application walkthrough

This small service exposes authenticated, tenant-scoped product paging/search/detail/delete and
records repository history. The snippets form one application; file comments show their location.

## 1. Entity

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

Enable PostgreSQL's `unaccent` extension before using contains-search.

## 2. Repository and service

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

## 3. Controller and feature module

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

The class-level permission protects every inherited route. For different read/delete permissions,
override each inherited method, add handler metadata, and delegate to `super`.

## 4. Root configuration

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

Create migrations for `Product` and the auto-loaded `ActionHistory` entity. A production token must
be signed by the configured issuer/secret and carry a UUID `sub`, a tenant, and
`product:manage`.

## 5. Exercise the routes

```bash
curl -X POST http://localhost:3000/products/paging \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"pageNumber":0,"pageSize":20}'
```

`TOKEN` is an application-issued test token, not a literal value. The inherited route returns HTTP
201 with `{ data: { items, total } }`. The first page is 0 and the library caps page size at 200.

The other inherited routes are:

- `POST /products/search?keyword=phone` → 201;
- `GET /products/:uuid` → 200; and
- `DELETE /products/:uuid` → 200 with `{ data: null }`.

Continue with [Testing](/examples/testing) before adding business mutations.
