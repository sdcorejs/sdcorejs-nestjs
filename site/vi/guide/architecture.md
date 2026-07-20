# Kiến trúc {#architecture}

Package được tổ chức quanh một ngữ cảnh bảo mật theo từng request và một tập hợp policy DI.

```text
HTTP request
  └─ ContextMiddleware (AsyncLocalStorage)
       ├─ AuthGuard → verified principal → permissions
       ├─ BaseController → BaseService → BaseRepository
       │                              ├─ tenancy predicates
       │                              ├─ audit fields
       │                              └─ optional action-history record
       ├─ CacheInterceptor → mandatory security namespace
       └─ HttpService → identity headers only to trusted origins
```

## Cơ chế và policy {#mechanism-versus-policy}

Thư viện đảm nhiệm các cơ chế có thể tái sử dụng:

- truyền request context mà không cần DI theo phạm vi request;
- thêm các điều kiện tenant vào thao tác repository;
- rào quyền thực thi job phân tán bằng lease trong cơ sở dữ liệu;
- chuẩn hóa response envelope và validation envelope; và
- áp dụng đường dẫn truy cập file và lịch sử có giới hạn, không để lộ khả năng liệt kê.

Ứng dụng đảm nhiệm policy:

- ánh xạ token đã xác minh thành `userId`, tenant, role và custom claim;
- cấp permission và quyền bỏ qua tenancy đặc quyền;
- quyết định có cho phép đọc file hoặc lịch sử hay không;
- lựa chọn chính sách lưu giữ dữ liệu; và
- khử trùng lặp các side effect bên ngoài của job.

## Các tầng module {#module-layers}

| Import | Tầng |
| --- | --- |
| `@sdcorejs/nestjs` | thành phần gốc và các token/type dùng chung |
| `@sdcorejs/nestjs/core` | context, tenancy, ORM, audit |
| `@sdcorejs/nestjs/auth` | JWT, permission, guard cho lời gọi nội bộ |
| `@sdcorejs/nestjs/services` | cache và HTTP outbound |
| `@sdcorejs/nestjs/validation` | guard và preset Zod v4 |
| `@sdcorejs/nestjs/i18n` | phân giải ngôn ngữ và thông điệp |
| `@sdcorejs/nestjs/features` | file đã tải lên, lịch sử, job lease |
| `@sdcorejs/nestjs/queue` | kết nối BullMQ, decorator, lớp worker cơ sở |

## Các ranh giới fail-closed {#fail-closed-boundaries}

- Danh tính từ header bị bỏ qua trừ khi `trustedHeaders.isTrustedRequest()` thành công.
- Xác minh JWT yêu cầu secret hoặc một policy issuer JWKS tường minh.
- Entity có phạm vi nhưng không có ngữ cảnh tenancy hợp lệ sẽ ném lỗi trước khi tạo SQL.
- Quyền bỏ qua tenant đặc quyền cần actor, lý do, allowlist target/operation và callback kiểm toán đồng bộ.
- `InternalGuard` từ chối lời gọi khi secret provider vắng mặt hoặc không khớp.
- Policy file và lịch sử trả về cùng một 404 cho tài nguyên không tồn tại và không được phép.
- Cache theo tenant/user bỏ qua việc lưu cache khi không thể tạo namespace danh tính bắt buộc một cách an toàn.

## Các ranh giới có trạng thái {#stateful-boundaries}

Object storage, PostgreSQL và API bên ngoài không dùng chung một transaction. File tải lên trước tiên
lưu một hàng pending bị ẩn, sau đó ghi object rồi kích hoạt hàng đó. Các lần ghi,
kích hoạt và xóa thất bại vẫn giữ một cleanup claim bền vững. Job theo lịch cung cấp một
`idempotencyKey` ổn định, nhưng ứng dụng phải dùng khóa đó trong outbox hoặc bản ghi khử trùng lặp downstream
trước khi tạo side effect bên ngoài.
