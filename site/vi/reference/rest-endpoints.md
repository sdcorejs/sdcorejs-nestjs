# Tham chiếu REST endpoint {#rest-endpoint-reference}

Thư viện không đăng ký một ứng dụng REST hoàn chỉnh. `BaseController` được controller của consumer
kế thừa, còn hai feature controller phải được liệt kê rõ ràng trong module của consumer. Hãy thêm
decorator phân quyền và route prefix của ứng dụng trong host.

## `BaseController` {#basecontroller}

Với `@Controller('products') class ProductController extends BaseController<...>`:

| Method | Route | Status Nest mặc định | Response |
| --- | --- | ---: | --- |
| `POST` | `/products/search?keyword=...` | 201 | `ApiResponse.ok(service.search(...))` |
| `POST` | `/products/paging` | 201 | `ApiResponse.ok(service.paging(...))` |
| `GET` | `/products/:id` | 200 | `ApiResponse.ok(service.detail(id))` |
| `DELETE` | `/products/:id` | 200 | `{ "data": null }` |

`ApiResponse.noContent()` đặt tên cho envelope rỗng; nó không áp dụng HTTP 204. Handler search và
paging dùng POST mà không có `@HttpCode`, vì vậy status thông thường của Nest là 201. Nếu hợp đồng
API của bạn yêu cầu status khác, hãy override method trong controller cụ thể và thêm
`@HttpCode(...)`.

Chủ đích không có route generic cho `all`, paging hàng đã xóa, xóa mềm hoặc restore. `detail` loại
các hàng đã xóa mềm trừ khi mã ứng dụng gọi repository với `{ withDeleted: true }`.

## Tệp đã tải lên {#uploaded-files}

Tự đăng ký `UploadedFileController`. Controller này được bảo vệ bởi `AuthGuard`.

| Method | Route | Kết quả |
| --- | --- | --- |
| `POST` | `/uploaded-file/initiate` | Metadata private pending và upload target trung lập provider |
| `POST` | `/uploaded-file/temporary/initiate` | Temporary pending private; không nhận visibility/TTL |
| `POST` | `/uploaded-file/:id/complete` | Verify/promote staging; kết quả an toàn có URL |
| `PUT` | `/uploaded-file/:id/content` | Raw binary target có giới hạn cho local driver |
| `GET` | `/uploaded-file/:id` | Detail đã phân quyền cùng preview URL public/private dùng được |
| `DELETE` | `/uploaded-file/:id` | Abort pending hoặc xóa ready bền vững; `{ "data": null }` |
| `POST` | `/uploaded-file?module=&entity=&entityId=&type=` | Một multipart field có buffer tên `file`; envelope upload đã validation |
| `GET` | `/uploaded-file/:id/download` | Stream được phân quyền với content header an toàn |

Multipart adapter nhận một tệp và có trần tuyệt đối 25 MiB; giới hạn service đã cấu hình có thể thấp
hơn. Direct initiate chỉ nhận metadata và từ chối public visibility, custom TTL, bucket và object key.
Response direct/detail loại storage key và URL field đã persist. ID tệp bị thiếu, không được phép,
sai định dạng và khác scope đều chủ đích không cho phép suy
đoán tài nguyên. Không expose các method maintenance `unsafeSystem*` thành route.

## Lịch sử thao tác {#action-history}

Tự đăng ký `ActionHistoryController`. Cả xác thực và policy `authorizeRead` của service đều bắt buộc.

```text
GET /action-history/:table/:tableId?pageNumber=0&pageSize=100
```

`table` là `EntityMetadata.tablePath` TypeORM ổn định, không phải display label tùy ý. Pagination
zero-based và có giới hạn. Resource thiếu và không được phép đều trả về 404.
