# Các lớp cơ sở ORM {#orm-base-classes}

Stack tiêu chuẩn là `BaseController → BaseService → BaseRepository`, được tham số hóa bằng một entity
và DTO. Repository đảm nhiệm cơ chế truy vấn/phạm vi, service ánh xạ output miền và mutation
policy, còn controller cung cấp một bề mặt HTTP nhỏ.

## Entity và repository {#entity-and-repository}

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

`logHistory: true` chỉ ghi lịch sử khi đã đăng ký recorder; bật
`actionHistory: {...}` sẽ đăng ký service tương ứng theo mặc định. Thao tác ghi lịch sử có phạm vi thất bại trước commit
nếu tài nguyên đã lưu không thể cung cấp đầy đủ phạm vi.

## Service và DTO {#service-and-dto}

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

`deletable` và `restorable` là cờ policy cấp service. `delete()`, `softDelete()` và
`restore()` chỉ tác động lên DTO có cờ tương ứng là true.

## Controller và hành vi HTTP thực tế {#controller-and-actual-http-behavior}

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

| Method | Route | Status mặc định của Nest | Body |
| --- | --- | --- | --- |
| POST | `/products/search?keyword=...` | 201 | `{ data: ProductDto[] }` |
| POST | `/products/paging` | 201 | `{ data: { items, total } }` |
| GET | `/products/:id` | 200 | `{ data: ProductDto \| null }` |
| DELETE | `/products/:id` | 200 | `{ data: null }` |

Không có `@HttpCode(204)` trên delete. Hãy override route và thêm `@HttpCode(...)` nếu
ứng dụng cần contract khác.

`all()`, `pagingDeleted()`, soft delete, restore, create, update và import là API service/repository
nhưng không được `BaseController` cung cấp. Hãy thêm route ứng dụng tường minh cùng permission và
validation.

## Phân trang, filter, relation và tìm kiếm {#paging-filters-relations-and-search}

- Trang được đánh số từ 0; `pageSize` bị bỏ qua/không dương trở thành 10 và giá trị trên 200 bị giới hạn.
- `all()` không có giới hạn. Không cung cấp nó dưới dạng endpoint public chung.
- `BaseRepositoryArgs.relations` hỗ trợ đường dẫn có dấu chấm và áp dụng phạm vi cho entity join có `@Scoped()`.
- `andWheres` dành cho điều kiện do ứng dụng sở hữu. Không bao giờ đặt chuỗi thô từ client vào SQL.
- Tên cột sort/filter được phân giải dựa trên metadata TypeORM.
- Tìm kiếm UUID là tra cứu có phạm vi chính xác; tìm kiếm được cấu hình trả về tối đa 20 hàng.
- Tìm kiếm chứa cần extension `unaccent` của PostgreSQL.

## Metadata schema {#schema-metadata}

```ts
import { Schema, SchemaProp } from '@sdcorejs/nestjs/core';

@Schema({ name: 'Product', description: 'Sellable catalog item' })
class ProductForm {
  @SchemaProp({ label: 'SKU', required: true, unique: true })
  sku!: string;
}
```

`@Schema()` và `@SchemaProp()` đính kèm metadata hướng đến UI được `service.schema()` trả về; chúng
không validate request. Dùng `ZodValidationGuard` để validation khi chạy.

## Transaction {#transactions}

Các method thay đổi của repository nhận một `QueryRunner` tùy chọn. Đối với thao tác có phạm vi, runner được cung cấp
phải có transaction đang hoạt động. Repository chỉ tự khởi tạo, commit, rollback và release
runner khi caller không cung cấp runner.
