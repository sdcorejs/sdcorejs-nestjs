# API ORM {#orm-api}

Đường dẫn import: `@sdcorejs/nestjs/core`

Lớp ORM cung cấp các lớp cơ sở TypeORM, contract filter/paging, decorator metadata và cầu nối
history-recorder tùy chọn. Nó không đăng ký entity thay cho bạn.

## Ví dụ hoàn chỉnh {#complete-example}

```ts
import { Controller, Injectable } from '@nestjs/common';
import { Column, DataSource, Entity } from 'typeorm';
import {
  BaseController,
  BaseEntity,
  BaseRepository,
  BaseService,
  type Dto,
  Schema,
  SchemaProp,
  Scoped,
  SearchableFields,
  WithAudit,
} from '@sdcorejs/nestjs/core';

@Entity('product')
@Schema({ name: 'Product' })
@SearchableFields({ exact: ['sku'], contain: ['name'], activeColumn: 'active' })
export class Product extends WithAudit(BaseEntity) {
  @Column()
  @Scoped()
  tenantCode!: string;

  @Column({ length: 64 })
  @SchemaProp({ label: 'SKU', required: true, unique: true })
  sku!: string;

  @Column()
  @SchemaProp({ label: 'Name', required: true })
  name!: string;

  @Column({ default: true })
  active!: boolean;
}

export interface ProductDto extends Dto {
  sku: string;
  name: string;
}

@Injectable()
export class ProductRepository extends BaseRepository<Product> {
  constructor(dataSource: DataSource) {
    super(Product, dataSource, { logHistory: true });
  }
}

@Injectable()
export class ProductService extends BaseService<Product, ProductDto> {
  constructor(repository: ProductRepository) {
    super(repository);
  }

  mapDTO(entity: Product | null | undefined): ProductDto | null | undefined {
    return entity && { id: entity.id, sku: entity.sku, name: entity.name, deletable: true };
  }
}

@Controller('products')
export class ProductController extends BaseController<Product, ProductDto> {
  constructor(service: ProductService) {
    super(service);
  }
}
```

Đăng ký `Product` trong datasource TypeORM của ứng dụng, đồng thời đăng ký repository, service và
controller như các provider Nest thông thường.

## Export entity và metadata {#entity-and-metadata-exports}

| Export | Loại | Contract |
| --- | --- | --- |
| `BaseEntity` | abstract class | Cột chính UUID `id` |
| `Constructor` | type | Constructor được mixin chấp nhận |
| `WithTimestamps` | mixin | Thêm `createdAt`, `updatedAt`, `deletedAt` |
| `WithAudit` | mixin | Thêm timestamp cùng `createdBy`, `modifiedBy`, `creator`, `modifier` |
| `isAuditEnabled` | function | Phát hiện metadata `WithAudit` qua inheritance |
| `UserSnapshot` | type | Hình dạng snapshot JSONB `{ id, username, fullName }` |
| `Scoped`, `ScopedOptions`, `ScopedColumnMetadata` | decorator/type | Đánh dấu cột tenancy bắt buộc hoặc tùy chọn |
| `getScopedColumns`, `getScopedColumnMetadata` | function | Đọc metadata scope được kế thừa |
| `SearchableFields`, `SearchableFieldsConfig` | decorator/type | Khai báo cột tìm kiếm exact/contain và cờ active tùy chọn |
| `getSearchableConfig` | function | Đọc metadata trường có thể tìm kiếm |
| `Schema`, `SchemaOptions` | decorator/type | Metadata UI/schema cấp class |
| `SchemaProp`, `SchemaPropOptions` | decorator/type | Metadata UI/schema cấp thuộc tính |
| `getSchema`, `getSchemaProps` | function | Đọc metadata schema được kế thừa |
| `ClassRef` | type | Tham chiếu class abstract hoặc concrete |

`WithAudit` dùng `jsonb` PostgreSQL cho `creator` và `modifier`. `DefaultAuditStrategy` chỉ điền các
trường UUID actor; việc điền snapshot thuộc về strategy của ứng dụng.

## Export repository và service {#repository-and-service-exports}

| Export | Loại | Mục đích |
| --- | --- | --- |
| `BaseRepository<T>`, `BaseRepositoryOptions` | class/type | Đọc, ghi, transaction, audit và hook history TypeORM có scope |
| `IBaseRepository<T>` | interface | Contract repository công khai có thể mock/inject |
| `BaseRepositoryArgs<T>` | interface | Relation, bao gồm soft-delete và predicate do ứng dụng sở hữu |
| `InactiveMutationTransactionError` | class | Runner được cung cấp không có transaction đang hoạt động |
| `BaseService<T, TDto>`, `IBaseService<T, TDto>` | class/interface | Lớp ánh xạ DTO và mutation-policy |
| `Dto` | interface | Yêu cầu `id`; cờ `deletable` và `restorable` tùy chọn |
| `BaseController<T, TDto>` | abstract class | Bề mặt REST tối thiểu search/paging/detail/delete |
| `Filter`, `FilterHasData`, `FilterBetween`, `FilterNoData`, `FilterAndOr` | type | Contract filter đệ quy dùng chung |
| `Operator`, `OperatorHasData`, `OperatorNoData` | type | Union operator filter dùng chung |
| `Order`, `PagingReq`, `PagingRes`, `QueryReq`, `NestedKeyOf` | type | Contract query, sắp xếp và phân trang dùng chung |
| `ApiErrorBody`, `ApiResponseEnvelope` | interface | Envelope error và response chuẩn |
| `apiError`, `ApiResponse` | value | Constructor envelope |

## API repository {#repository-api}

```ts
new BaseRepository<T>(target, dataSource, options?)

interface BaseRepositoryOptions {
  logHistory?: boolean;
  tenancyStrategy?: ITenancyStrategy;
  auditStrategy?: IAuditStrategy;
  contextService?: ContextService;
  historyRecorder?: IHistoryRecorder;
}
```

| Thành viên | Signature / hành vi |
| --- | --- |
| `MAX_PAGE_SIZE` | Giới hạn cứng static: `200` |
| `paging` | `(req: PagingReq<T>, args?: BaseRepositoryArgs<T>) => Promise<PagingRes<T>>` |
| `pagingDeleted` | Cùng signature; bao gồm cả hàng active và soft-delete |
| `all` | `(filters?, args?) => Promise<T[]>`; chủ ý không giới hạn |
| `search` | `(keyword, filters?) => Promise<T[]>`; tra UUID exact hoặc tối đa 20 kết quả đã cấu hình |
| `detail` | `(id, args?) => Promise<T \| null>`; validation UUID; mặc định loại soft-delete |
| `findByIds` | `(ids, args?) => Promise<T[]>`; loại trùng và áp dụng tenancy scope |
| `create` | `(entity, queryRunner?) => Promise<T>` |
| `update` | `(entityWithId, queryRunner?) => Promise<T>`; cột scope là bất biến |
| `delete` | `(idOrIds, queryRunner?) => Promise<boolean>`; hard delete |
| `softDelete` | `(idOrIds, queryRunner?) => Promise<boolean>` |
| `restore` | `(idOrIds, queryRunner?) => Promise<boolean>` |
| `import` | `(entities, queryRunner?) => Promise<T[]>`; insert theo chunk 1,000 |
| `target` | Getter `EntityTarget<T>` TypeORM |
| `unsafeRepository` | Repository TypeORM thô; bypass tenancy và mutation guard |
| `unsafeGetRepository` | Repository thô cho runner tùy chọn; cùng cảnh báo |
| `unsafeCreateQueryRunner` | Factory runner thô; caller sở hữu vòng đời và tính an toàn |

Mutation tự sở hữu transaction trừ khi caller cung cấp `QueryRunner`. Runner được cung cấp phải có
transaction đang hoạt động, nếu không sẽ ném `InactiveMutationTransactionError`. Mutation batch có
scope yêu cầu mọi hàng được đề nghị đều khớp; khớp một phần trả cùng lỗi not-found.

`BaseRepositoryArgs<T>` chấp nhận `relations?: string[]`, `withDeleted?: boolean` và
`andWheres?: { where; parameters? }[]` có parameter. `withDeleted: true` nghĩa là cả hàng active
**và** đã xóa; đây không phải filter chỉ lấy hàng đã xóa. Đường dẫn relation lồng nhau được join từ
parent trước và mỗi relation có scope nhận predicate tenancy riêng.

## Phân trang, lọc và sắp xếp {#pagination-filtering-and-sorting}

`PagingReq`, `PagingRes`, `QueryReq`, `Order`, `Filter`, `FilterHasData`, `FilterBetween`,
`FilterNoData`, `FilterAndOr`, `Operator`, `OperatorHasData`, `OperatorNoData` và `NestedKeyOf` là
re-export chỉ kiểu từ `@sdcorejs/utils/models`.

```ts
const page = await products.paging({
  pageNumber: 0, // zero-based: first page
  pageSize: 25,  // 1..200; default 10
  filters: [
    { field: 'active', operator: 'EQUAL', data: true },
    {
      operator: 'OR',
      data: [
        { field: 'name', operator: 'CONTAIN', data: 'phone' },
        { field: 'sku', operator: 'START_WITH', data: 'PH-' },
      ],
    },
  ],
  orders: [{ field: 'createdAt', direction: 'DESC' }],
});
```

Phân trang repository bắt đầu từ **0**, dù kiểu cấu trúc dùng chung không bắt buộc ngữ nghĩa
runtime. Trang âm trở thành `0`; size bị thiếu/không dương trở thành `10`; size lớn hơn `200` bị
giới hạn. Các operator được hỗ trợ là `EQUAL`, `NOT_EQUAL`, `CONTAIN`, `NOT_CONTAIN`, `IN`,
`NOT_IN`, `START_WITH`, `NOT_START_WITH`, `END_WITH`, `NOT_END_WITH`, `GREATER_THAN`, `LESS_THAN`,
`GREATER_OR_EQUAL`, `LESS_OR_EQUAL`, `BETWEEN`, `NULL`, `NOT_NULL`, `AND` và `OR`.

## API service và controller {#service-and-controller-api}

`IBaseRepository<T>` và `IBaseService<T, TDto>` công khai contract của các lớp cơ sở tương ứng để
dùng với DI và mock. `Dto` yêu cầu `id`; `deletable` và `restorable` là cờ policy opt-in được method
mutation service sử dụng.

`BaseService` ánh xạ kết quả repository qua `mapDTO` abstract và công khai `paging`,
`pagingDeleted`, `all`, `search`, `detail`, `create`, `import`, `update`, `delete`, `softDelete`,
`restore` và `schema`. Các method delete/restore tải mọi ID được yêu cầu trong scope và chỉ tác động
lên DTO có cờ policy tương ứng là true.

`BaseController` chỉ mount bề mặt tối thiểu sau:

| Route | Method | Kết quả |
| --- | --- | --- |
| `/search?keyword=...` | `POST` | `ApiResponse.ok(service.search(keyword, bodyFilters))` |
| `/paging` | `POST` | `ApiResponse.ok(service.paging(body))` |
| `/:id` | `GET` | `ApiResponse.ok(service.detail(id))` |
| `/:id` | `DELETE` | Hard delete, sau đó `{ data: null }` |

Nó không thêm permission. Override method hoặc định nghĩa controller ứng dụng rõ ràng với
`AuthGuard` và `@HasPermission(...)`.

## Cầu nối history {#history-bridge}

| Export | Contract |
| --- | --- |
| `HistoryActionType` | `'CREATE' \| 'UPDATE' \| 'DELETE'` |
| `HistoryEntry` | Table path, row ID, dữ liệu trước/sau, resource scope đã persist và runner tùy chọn |
| `IHistoryRecorder` | `record(entry: HistoryEntry): Promise<void>` |
| `registerHistoryRecorder` | Đăng ký recorder toàn process |
| `MissingHistoryResourceScopeError` | Hàng có scope không thể cung cấp đầy đủ history scope tin cậy |

Đặt `logHistory: true` trên repository. `ActionHistoryModule` mặc định đăng ký service của nó làm
recorder và ghi trong transaction repository. Nếu không có recorder, logging là no-op. Xem
[Lịch sử thao tác](../features/action-history.md).

## Các kiểu và helper công khai khác {#other-public-types-and-helpers}

`ApiErrorBody`, `ApiResponseEnvelope`, `apiError` và `ApiResponse` định nghĩa hình dạng response
chuẩn. Xem [package root](../root.md#response-helpers).

## Hành vi PostgreSQL {#postgresql-behavior}

Base repository chủ ý phát cú pháp PostgreSQL:

- Khớp văn bản dùng `LOWER(UNACCENT(column::text))`; hãy bật extension PostgreSQL `unaccent`.
- Đường dẫn filter JSON/JSONB dùng operator `->` và `->>`.
- Sắp xếp dùng `NULLS FIRST` cho chiều tăng và `NULLS LAST` cho chiều giảm.
- `import()` dùng `INSERT ... RETURNING *`.
- `WithAudit` cùng một số feature entity dùng `jsonb`; UUID và cột timestamp-with-time-zone cũng
  thuộc schema tích hợp.

Coi các database engine khác là không được hỗ trợ trừ khi ứng dụng đã xác minh mọi query được tạo
và thay thế các kiểu cột entity không tương thích.

## Lỗi và lưu ý bảo mật {#errors-and-security-notes}

- UUID, trường, sắp xếp và đường dẫn relation không hợp lệ dùng các mã lỗi `core.repository.*` ổn
  định.
- Tên trường filter bị giới hạn ở ký tự path an toàn và giá trị được parameter hóa; sort và
  relation được validation bằng metadata. Không công khai `BaseRepositoryArgs.andWheres` tùy ý cho
  client.
- `all()` không giới hạn và chủ ý không có trong `BaseController`; chỉ công khai nó cho dataset nhỏ
  đã biết hoặc thêm giới hạn riêng của ứng dụng.
- Accessor `unsafe*` bypass tenancy, authorization, kiểm tra số hàng bị tác động và history. Giới
  hạn chúng trong mã hạ tầng đã review.
