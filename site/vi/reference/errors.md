# Danh mục lỗi {#error-catalog}

Lỗi trả qua HTTP dùng `{ code, message, data? }` bên trong response shape của Nest. Với
`SdI18nExceptionFilter`, `message` và message của validation issue được dịch từ catalog Anh/Việt
tích hợp sẵn cộng với override của ứng dụng.

| Mã | Status thường gặp | Ý nghĩa |
| --- | ---: | --- |
| `core.validation.failed` | 400 | Một hoặc nhiều nguồn Zod thất bại |
| `core.validation.uuid` | 400 | Preset UUID không hợp lệ |
| `core.validation.page-number.min` | 400 | Số trang nhỏ hơn 0 |
| `core.validation.page-size.min` | 400 | Kích thước trang nhỏ hơn 1 |
| `core.validation.page-size.max` | 400 | Kích thước trang vượt quá 200 |
| `core.permission.forbidden` | 403 | Thiếu permission bắt buộc |
| `core.permission.internal-secret-missing` | 403 | Thiếu header secret nội bộ |
| `core.permission.internal-secret-mismatch` | 403 | Secret nội bộ không khớp active key nào |
| `core.permission.internal-secret-provider-missing` | 500 | Internal guard không có secret provider |
| `core.context.verified-principal-missing` | 401 | Bắt buộc có principal đã xác minh |
| `core.context.verified-principal-invalid` | 401 | Ánh xạ principal không tạo ra danh tính đáng tin cậy |
| `core.context.identity-conflict` | 401 | Danh tính JWT và trusted gateway xung đột |
| `core.repository.invalid-uuid` | 400 | ID mutation/detail của repository không hợp lệ |
| `core.repository.invalid-field-name` | 400 | Cú pháp field của filter không an toàn |
| `core.repository.invalid-sort-field` | 400 | Cú pháp field sắp xếp không an toàn |
| `core.repository.column-not-found` | 400 | Cột entity đã phân giải không tồn tại |
| `core.repository.relation-not-found` | 400 | Relation được yêu cầu không tồn tại |
| `core.repository.relation-not-found-in` | 400 | Relation lồng nhau không hợp lệ |
| `core.repository.column-not-found-in` | 400 | Cột relation lồng nhau không hợp lệ |
| `core.repository.not-found` | 404 | Mutation/resource có scope không khớp chính xác |
| `core.file.empty` | 400 | Multipart controller không nhận được tệp |
| `core.file.invalid-meta` | 400 | Metadata upload không đạt validation kiểu/giới hạn |
| `core.file.invalid-upload` | 400 | Validation size, MIME, extension, signature hoặc tên thất bại |
| `core.file.upload-failed` | 400 | Persistence/storage/activation thất bại mà không rò rỉ thông tin nội bộ |
| `core.file.not-found` | 404 | Tệp thiếu, sai định dạng, không được phép hoặc khác scope |
| `core.file.remote-disabled` | 400 | Remote clone chưa được bật rõ ràng |
| `core.file.remote-fetch-failed` | 400 | Remote fetch đã tăng cường bảo mật bị từ chối hoặc thất bại |
| `core.file.temporary-cleanup-required` | 400 | Upload tạm thời không có thời gian cleanup dương |
| `core.file.delete-failed` | 400 | Việc xóa object vẫn ở trạng thái pending bền vững |
| `core.file.cleanup-failed` | 400 | Maintenance purge chưa hoàn tất |
| `core.history.not-found` | 404 | Lần đọc lịch sử bị thiếu hoặc không được phép |
| `core.cache.invalid-redis-key-prefix` | startup | Prefix Redis rỗng hoặc chứa metacharacter glob |

## Lỗi vận hành có kiểu {#typed-operational-errors}

Một số điều kiện fail-closed là lỗi có kiểu thay vì mã HTTP được bản địa hóa: lỗi tenancy
(`MissingTenancyContextError`, `MissingTenancyScopeError`, `InvalidTenancyScopeError`,
`TenancyScopeMutationError`, `UnauthorizedTenancyBypassError`), sử dụng transaction sai
(`InactiveMutationTransactionError`), lỗi định danh/thời gian/lease của job, lỗi scope/giới hạn
snapshot lịch sử và prefix Redis không hợp lệ. Chỉ chuyển đổi chúng tại ranh giới ứng dụng khi bạn
có thể giữ nguyên ngữ nghĩa bảo mật không cho phép suy đoán tài nguyên.
