# ORM API

Import path: `@sdcorejs/nestjs/core`

The ORM layer supplies TypeORM base classes, filter/paging contracts, metadata decorators and an
optional history-recorder bridge. It does not register entities for you.

## Complete example

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

Register `Product` in the application's TypeORM datasource and register the repository, service and
controller as normal Nest providers.

## Entity and metadata exports

| Export | Kind | Contract |
| --- | --- | --- |
| `BaseEntity` | abstract class | UUID `id` primary column |
| `Constructor` | type | Constructor accepted by mixins |
| `WithTimestamps` | mixin | Adds `createdAt`, `updatedAt`, `deletedAt` |
| `WithAudit` | mixin | Adds timestamps plus `createdBy`, `modifiedBy`, `creator`, `modifier` |
| `isAuditEnabled` | function | Detects `WithAudit` metadata through inheritance |
| `UserSnapshot` | type | `{ id, username, fullName }` JSONB snapshot shape |
| `Scoped`, `ScopedOptions`, `ScopedColumnMetadata` | decorator/types | Marks required or optional tenancy columns |
| `getScopedColumns`, `getScopedColumnMetadata` | functions | Reads inherited scope metadata |
| `SearchableFields`, `SearchableFieldsConfig` | decorator/type | Declares exact/contain search columns and optional active flag |
| `getSearchableConfig` | function | Reads searchable-field metadata |
| `Schema`, `SchemaOptions` | decorator/type | Class-level UI/schema metadata |
| `SchemaProp`, `SchemaPropOptions` | decorator/type | Property-level UI/schema metadata |
| `getSchema`, `getSchemaProps` | functions | Reads inherited schema metadata |
| `ClassRef` | type | Abstract or concrete class reference |

`WithAudit` uses PostgreSQL `jsonb` for `creator` and `modifier`. `DefaultAuditStrategy` fills only
the UUID actor fields; snapshot population belongs in an application strategy.

## Repository and service exports

| Export | Kind | Purpose |
| --- | --- | --- |
| `BaseRepository<T>`, `BaseRepositoryOptions` | class/type | Scoped TypeORM reads, writes, transactions, audit and history hooks |
| `IBaseRepository<T>` | interface | Mockable/injectable public repository contract |
| `BaseRepositoryArgs<T>` | interface | Relations, soft-deleted inclusion and application-owned predicates |
| `InactiveMutationTransactionError` | class | Supplied runner has no active transaction |
| `BaseService<T, TDto>`, `IBaseService<T, TDto>` | class/interface | DTO mapping and mutation-policy layer |
| `Dto` | interface | Requires `id`; optional `deletable` and `restorable` flags |
| `BaseController<T, TDto>` | abstract class | Minimal search/paging/detail/delete REST surface |
| `Filter`, `FilterHasData`, `FilterBetween`, `FilterNoData`, `FilterAndOr` | types | Shared recursive filter contracts |
| `Operator`, `OperatorHasData`, `OperatorNoData` | types | Shared filter operator unions |
| `Order`, `PagingReq`, `PagingRes`, `QueryReq`, `NestedKeyOf` | types | Shared query, sort and paging contracts |
| `ApiErrorBody`, `ApiResponseEnvelope` | interfaces | Standard error and response envelopes |
| `apiError`, `ApiResponse` | values | Envelope constructors |

## Repository API

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

| Member | Signature / behavior |
| --- | --- |
| `MAX_PAGE_SIZE` | Static hard cap: `200` |
| `paging` | `(req: PagingReq<T>, args?: BaseRepositoryArgs<T>) => Promise<PagingRes<T>>` |
| `pagingDeleted` | Same signature; includes active and soft-deleted rows |
| `all` | `(filters?, args?) => Promise<T[]>`; deliberately unbounded |
| `search` | `(keyword, filters?) => Promise<T[]>`; UUID exact lookup or at most 20 configured matches |
| `detail` | `(id, args?) => Promise<T \| null>`; validates UUID; excludes soft-deleted by default |
| `findByIds` | `(ids, args?) => Promise<T[]>`; deduplicated and tenancy-scoped |
| `create` | `(entity, queryRunner?) => Promise<T>` |
| `update` | `(entityWithId, queryRunner?) => Promise<T>`; scope columns are immutable |
| `delete` | `(idOrIds, queryRunner?) => Promise<boolean>`; hard delete |
| `softDelete` | `(idOrIds, queryRunner?) => Promise<boolean>` |
| `restore` | `(idOrIds, queryRunner?) => Promise<boolean>` |
| `import` | `(entities, queryRunner?) => Promise<T[]>`; inserts in chunks of 1,000 |
| `target` | TypeORM `EntityTarget<T>` getter |
| `unsafeRepository` | Raw TypeORM repository; bypasses tenancy and mutation guards |
| `unsafeGetRepository` | Raw repository for an optional runner; same warning |
| `unsafeCreateQueryRunner` | Raw runner factory; caller owns lifecycle and safety |

Mutations own a transaction unless supplied a caller-owned `QueryRunner`. A supplied runner must
already have an active transaction or `InactiveMutationTransactionError` is thrown. Scoped batch
mutations require every requested row to match; partial matches return the same not-found error.

`BaseRepositoryArgs<T>` accepts `relations?: string[]`, `withDeleted?: boolean`, and parameterized
`andWheres?: { where; parameters? }[]`. `withDeleted: true` means active **and** deleted rows; it is
not a deleted-only filter. Nested relation paths are joined parent-first and each scoped relation
receives its own tenancy predicate.

## Pagination, filtering and sorting

`PagingReq`, `PagingRes`, `QueryReq`, `Order`, `Filter`, `FilterHasData`, `FilterBetween`,
`FilterNoData`, `FilterAndOr`, `Operator`, `OperatorHasData`, `OperatorNoData`, and `NestedKeyOf` are
type-only re-exports from `@sdcorejs/utils/models`.

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

Repository pagination is **zero-based**, even though the shared structural type does not enforce
runtime semantics. Negative pages become `0`; missing/non-positive sizes become `10`; sizes above
`200` are clamped. Supported operators are `EQUAL`, `NOT_EQUAL`, `CONTAIN`, `NOT_CONTAIN`, `IN`,
`NOT_IN`, `START_WITH`, `NOT_START_WITH`, `END_WITH`, `NOT_END_WITH`, `GREATER_THAN`, `LESS_THAN`,
`GREATER_OR_EQUAL`, `LESS_OR_EQUAL`, `BETWEEN`, `NULL`, `NOT_NULL`, `AND`, and `OR`.

## Service and controller API

`IBaseRepository<T>` and `IBaseService<T, TDto>` expose the public contracts of the corresponding
base classes for DI and mocks. `Dto` requires `id`; `deletable` and `restorable` are opt-in policy
flags used by service mutation methods.

`BaseService` maps repository results through abstract `mapDTO` and exposes `paging`,
`pagingDeleted`, `all`, `search`, `detail`, `create`, `import`, `update`, `delete`, `softDelete`,
`restore`, and `schema`. Delete/restore methods load every requested ID in scope and act only on
DTOs whose policy flag is true.

`BaseController` mounts only this minimal surface:

| Route | Method | Result |
| --- | --- | --- |
| `/search?keyword=...` | `POST` | `ApiResponse.ok(service.search(keyword, bodyFilters))` |
| `/paging` | `POST` | `ApiResponse.ok(service.paging(body))` |
| `/:id` | `GET` | `ApiResponse.ok(service.detail(id))` |
| `/:id` | `DELETE` | Hard delete, then `{ data: null }` |

It does not add permissions. Override methods or define explicit application controllers with
`AuthGuard` and `@HasPermission(...)`.

## History bridge

| Export | Contract |
| --- | --- |
| `HistoryActionType` | `'CREATE' \| 'UPDATE' \| 'DELETE'` |
| `HistoryEntry` | Table path, row ID, before/after data, persisted resource scope and optional runner |
| `IHistoryRecorder` | `record(entry: HistoryEntry): Promise<void>` |
| `registerHistoryRecorder` | Registers the process-wide recorder |
| `MissingHistoryResourceScopeError` | Scoped row could not provide complete trusted history scope |

Set `logHistory: true` on a repository. `ActionHistoryModule` registers its service as the recorder
by default and writes within the repository transaction. If no recorder is available, logging is a
no-op. See [Action history](../features/action-history.md).

## Other public types and helpers

`ApiErrorBody`, `ApiResponseEnvelope`, `apiError`, and `ApiResponse` define the standard response
shape. See the [package root](../root.md#response-helpers).

## PostgreSQL behavior

The base repository intentionally emits PostgreSQL syntax:

- Text matching uses `LOWER(UNACCENT(column::text))`; enable the PostgreSQL `unaccent` extension.
- JSON/JSONB nested filter paths use `->` and `->>` operators.
- Sorts use `NULLS FIRST` for ascending and `NULLS LAST` for descending.
- `import()` uses `INSERT ... RETURNING *`.
- `WithAudit` and several feature entities use `jsonb`; UUIDs and timestamp-with-time-zone columns
  are also part of the built-in schemas.

Treat other database engines as unsupported unless your application has verified every generated
query and substituted incompatible entity column types.

## Errors and security notes

- Invalid UUIDs, fields, sorts and relation paths use stable `core.repository.*` error codes.
- Filter field names are restricted to safe path characters and values are parameterized; sorts
  and relations are metadata-validated. Do not expose arbitrary `BaseRepositoryArgs.andWheres` to
  clients.
- `all()` is unbounded and is intentionally absent from `BaseController`; expose it only for known
  small datasets or add an application-specific limit.
- `unsafe*` accessors bypass tenancy, authorization, affected-row checks and history. Restrict them
  to reviewed infrastructure code.
