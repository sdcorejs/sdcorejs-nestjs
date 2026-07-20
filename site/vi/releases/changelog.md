# Nhật ký thay đổi {#changelog}

## 1.1.0 {#_1-1-0}

- Tăng cường danh tính đã xác minh, độ tin cậy của gateway, tenancy, mutation có scope, truyền
  cache/HTTP, tệp đã tải lên, lịch sử thao tác và job lease phân tán.
- Bổ sung upload pending-first bền vững qua sự cố với activation tombstone/deletion claim rõ ràng và
  retry backoff cho hàng lỗi, khóa idempotency ổn định, danh mục lỗi core đầy đủ, cấu hình S3/JWT
  fail-fast, mặc định detail xóa mềm an toàn và giới hạn pagination nhất quán.
- Xây dựng lại cổng tài liệu với navigation toàn cục, tham chiếu public API đầy đủ, ví dụ hoàn chỉnh,
  tài liệu tham chiếu vận hành/bảo mật và lộ trình migration rõ ràng.
- Yêu cầu Node.js 20 trở lên và migration consumer có phối hợp.

## 1.0.0 {#_1-0-0}

Bản phát hành ổn định đầu tiên với các public entry point được nhóm, declaration ESM/CJS kép, khả
năng kết hợp NestJS 11, các module ORM/context/tenancy/audit/auth/services/queue/validation/i18n và
các tính năng tệp đã tải lên/lịch sử thao tác/bộ lập lịch tác vụ được hợp nhất.

Để xem release note theo từng commit, hãy xem
[CHANGELOG.md](https://github.com/sdcorejs/sdcorejs-nestjs/blob/main/CHANGELOG.md) của package.
