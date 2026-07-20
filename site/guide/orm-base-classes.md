# ORM base classes

The standard stack is `BaseController → BaseService → BaseRepository`, parameterized by an entity
and a DTO. The repository owns query/scoping mechanics, the service maps domain output and mutation
policy, and the controller exposes a small HTTP surface.

## Entity and repository

```ts
import { Inject, Injectable } from '@nestjs/common';
import { Column, DataSource, Entity, Index } from 'typeorm';
import {
  AUDIT_STRATEGY,
  BaseEntity,
  BaseRepository,
  ContextService,
  Scoped,
  SearchableFields,
  TENANCY_STRATEGY,
  WithAudit,
  type IAuditStrategy,
  type ITenancyStrategy,
} from '@sdcorejs/nestjs/core';

@SearchableFields({ exact: ['sku'], contain: ['name'], activeColumn: 'isActive' })
@Entity('product')
@Index(['tenantCode', 'sku'], { unique: true })
export class Product extends WithAudit(BaseEntity) {
  @Column() @Scoped() tenantCode!: string;
  @Column() sku!: string;
  @Column() name!: string;
  @Column({ default: true }) isActive!: boolean;
}

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
```

`logHistory: true` writes history only when a recorder is registered; enabling
`actionHistory: {...}` registers its service by default. A scoped history write fails before commit
if the persisted resource cannot supply its complete scope.

## Service and DTO

```ts
import { Injectable } from '@nestjs/common';
import { BaseService, type Dto } from '@sdcorejs/nestjs/core';

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

`deletable` and `restorable` are service-level policy flags. `delete()`, `softDelete()`, and
`restore()` act only on DTOs whose corresponding flag is true.

## Controller and actual HTTP behavior

```ts
import { Controller } from '@nestjs/common';
import { BaseController } from '@sdcorejs/nestjs/core';

@Controller('products')
export class ProductController extends BaseController<Product, ProductDto> {
  constructor(service: ProductService) {
    super(service);
  }
}
```

| Method | Route | Nest default status | Body |
| --- | --- | --- | --- |
| POST | `/products/search?keyword=...` | 201 | `{ data: ProductDto[] }` |
| POST | `/products/paging` | 201 | `{ data: { items, total } }` |
| GET | `/products/:id` | 200 | `{ data: ProductDto \| null }` |
| DELETE | `/products/:id` | 200 | `{ data: null }` |

There is no `@HttpCode(204)` on delete. Override a route and add `@HttpCode(...)` if your
application needs another contract.

`all()`, `pagingDeleted()`, soft delete, restore, create, update, and import are service/repository
APIs but are not exposed by `BaseController`. Add explicit application routes with permissions and
validation.

## Paging, filters, relations, and search

- Pages are 0-based; omitted/non-positive `pageSize` becomes 10 and values above 200 are capped.
- `all()` has no limit. Do not expose it as a generic public endpoint.
- `BaseRepositoryArgs.relations` supports dot paths and scopes joined `@Scoped()` entities.
- `andWheres` is for application-owned predicates. Never place raw client strings in SQL.
- Sort/filter column names are resolved against TypeORM metadata.
- UUID search is an exact scoped lookup; configured search returns at most 20 rows.
- Contains-search requires PostgreSQL's `unaccent` extension.

## Schema metadata

```ts
import { Schema, SchemaProp } from '@sdcorejs/nestjs/core';

@Schema({ name: 'Product', description: 'Sellable catalog item' })
class ProductForm {
  @SchemaProp({ label: 'SKU', required: true, unique: true })
  sku!: string;
}
```

`@Schema()` and `@SchemaProp()` attach UI-facing metadata returned by `service.schema()`; they do
not validate requests. Use `ZodValidationGuard` for runtime validation.

## Transactions

Repository mutation methods accept an optional `QueryRunner`. For scoped operations, a supplied
runner must have an active transaction. The repository starts, commits, rolls back, and releases its
own runner only when the caller did not supply one.
