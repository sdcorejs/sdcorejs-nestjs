# Ví dụ {#examples}

Các công thức này chỉ dùng tám entry point được package hỗ trợ. Mỗi trang đều nêu rõ khi một symbol
thuộc về ứng dụng thay vì là API của thư viện.

| Ví dụ | Nội dung minh họa |
| --- | --- |
| [Ứng dụng hoàn chỉnh](/vi/examples/complete-app) | module, entity, repository, service và controller end-to-end |
| [CRUD tenant](/vi/examples/tenant-crud) | stack ORM cơ sở có scope, paging và HTTP status thực tế |
| [Danh tính và permission](/vi/examples/identity-and-permissions) | ánh xạ principal đã xác minh và permission cho route |
| [Cache và HTTP](/vi/examples/cache-and-http) | interceptor bắt buộc, cô lập cache, origin đáng tin cậy |
| [Upload](/vi/examples/uploaded-files) | cấu hình S3/local, controller riêng tư, vòng đời attach/delete |
| [Lịch sử thao tác](/vi/examples/action-history) | snapshot tự động, redaction, quyền đọc |
| [Job đã lên lịch](/vi/examples/scheduled-jobs) | khóa idempotency ổn định và dạng transactional outbox |
| [Kiểm thử](/vi/examples/testing) | assertion bảo mật unit/integration/E2E |

Các snippet được chủ đích giữ đủ nhỏ để điều chỉnh. Những giá trị như tên permission theo domain,
URL issuer Keycloak, storage bucket và field entity vẫn là policy của ứng dụng.
