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
| POST | `/paging` | `paging(req)` |
| GET | `/all` | `all()` |
| GET | `/:id` | `detail(id)` (tenancy-scoped) |
| DELETE | `/:id` | `delete(id)` |

`@SearchableFields({ exact, contain, activeColumn })` configures the `search` endpoint; `@Schema` adds
DTO introspection metadata. Reads and writes are tenancy-scoped automatically — see
[Multi-tenancy](/guide/multi-tenancy).

The full `@sdcorejs/nestjs/core` surface also exports `WithTimestamps`, `WithAudit`, `apiError` /
`ApiResponse`, the request-context primitives, and the tenancy + audit strategy tokens.
