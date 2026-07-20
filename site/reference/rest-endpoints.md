# REST endpoint reference

The library does not register a complete REST application. `BaseController` is inherited by a
consumer controller, while the two feature controllers must be listed explicitly in a consumer
module. Add application authorization decorators and route prefixes in the host.

## `BaseController`

For `@Controller('products') class ProductController extends BaseController<...>`:

| Method | Route | Default Nest status | Response |
| --- | --- | ---: | --- |
| `POST` | `/products/search?keyword=...` | 201 | `ApiResponse.ok(service.search(...))` |
| `POST` | `/products/paging` | 201 | `ApiResponse.ok(service.paging(...))` |
| `GET` | `/products/:id` | 200 | `ApiResponse.ok(service.detail(id))` |
| `DELETE` | `/products/:id` | 200 | `{ "data": null }` |

`ApiResponse.noContent()` names the empty envelope; it does not apply HTTP 204. Search and paging
are POST handlers without `@HttpCode`, so Nest's normal status is 201. If your API contract requires
different statuses, override the method in the concrete controller and add `@HttpCode(...)`.

There are intentionally no generic routes for `all`, deleted-row paging, soft delete, or restore.
`detail` excludes soft-deleted rows unless application code calls the repository with
`{ withDeleted: true }`.

## Uploaded files

Register `UploadedFileController` yourself. It is guarded by `AuthGuard`.

| Method | Route | Result |
| --- | --- | --- |
| `POST` | `/uploaded-file?module=&entity=&entityId=&type=` | One buffered multipart field named `file`; validated upload envelope |
| `GET` | `/uploaded-file/:id/download` | Authorized stream with safe content headers |

The multipart adapter accepts one file and has a 25 MiB absolute ceiling; the configured service
limit can be lower. Missing, unauthorized, malformed, and cross-scope file IDs are intentionally
non-enumerating. Do not expose the `unsafeSystem*` maintenance methods as routes.

## Action history

Register `ActionHistoryController` yourself. Authentication and the service's `authorizeRead`
policy are both required.

```text
GET /action-history/:table/:tableId?pageNumber=0&pageSize=100
```

`table` is the stable TypeORM `EntityMetadata.tablePath`, not an arbitrary display label. Pagination
is zero-based and bounded. Missing and unauthorized resources both return 404.
