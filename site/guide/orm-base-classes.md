# ORM base classes

`BaseController` → `BaseService` → `BaseRepository`, parameterized by entity `T` and DTO `TDto`.

```ts
// repository.ts
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseRepository } from '@sdcorejs/nestjs/core';

@Injectable()
export class ProductRepository extends BaseRepository<Product> {
  constructor(ds: DataSource, /* inject strategies + ContextService via options */) {
    super(Product, ds, { /* tenancyStrategy, auditStrategy, contextService */ });
  }
}
```

`BaseController` mounts the standard endpoint set:

| Method | Route | Service call |
|---|---|---|
| POST | `/search` | `search(keyword, filters)` |
| POST | `/paging` | `paging(req)` — `pageSize` capped at **200** |
| GET | `/:id` | `detail(id)` (tenancy-scoped) |
| DELETE | `/:id` | `delete(id)` |

`all()` (unbounded full-table read), `pagingDeleted`, soft-delete and restore live on
`BaseService` / `BaseRepository` but are **not** exposed by the controller — a generic full-table read
is rarely safe to expose, so add an `@Get('all')` in your subclass only where it's appropriate.
`@SearchableFields({ exact, contain, activeColumn })` configures the `search` endpoint; `@Schema` adds
DTO introspection metadata. Reads and writes (including `search` by UUID) are tenancy-scoped
automatically — see [Multi-tenancy](/guide/multi-tenancy).

The full `@sdcorejs/nestjs/core` surface also exports `WithTimestamps`, `WithAudit`, `apiError` /
`ApiResponse`, the request-context primitives, and the tenancy + audit strategy tokens.
