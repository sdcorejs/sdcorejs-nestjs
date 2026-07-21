# Khả năng tương thích {#compatibility}

| Khu vực | Hợp đồng được hỗ trợ/kiểm thử |
| --- | --- |
| Node.js | `>=20`; CI nhắm đến Node 20.x và 22.x hiện hành |
| NestJS | Peer `@nestjs/common` và `@nestjs/core` `^11` |
| TypeORM | Dòng dependency `0.3.x` |
| Định dạng module | Node ESM và CommonJS với declaration tương ứng |
| Cơ sở dữ liệu | Triển khai tính năng riêng cho PostgreSQL; unit/integration test dùng `pg-mem` |
| Validation | Zod v4 khi dùng các helper validation |
| Queue | BullMQ v5 thông qua `@nestjs/bullmq` v11 |
| S3 | Client AWS SDK v3; không cam kết cho mọi nhà cung cấp tương thích S3 |
| OIDC | `passport-jwt`, `jwks-rsa`, `jsonwebtoken`; bắt buộc có issuer policy |

Bộ test tự động hiện không chạy các dịch vụ PostgreSQL, Redis, Keycloak hoặc S3 thật. Bộ test dùng
adapter/mock chuyên biệt và mô phỏng PostgreSQL. Hãy xác thực chính xác hạ tầng của bạn trong ứng
dụng host, đặc biệt là conditional write của object store, proxy trust, topology Redis, claim OIDC
và SQL migration.

## Ngoại lệ của công cụ tài liệu {#documentation-tooling-exception}

Dòng VitePress 1.6 ổn định khai báo dải Vite 5 mà bản tương thích mới nhất vẫn còn advisory chưa xử
lý trên development server. Workspace tài liệu pin một bản Vite 6 không có lỗi audit bằng npm
override; bản này nằm ngoài dải khai báo của VitePress nhưng được bao phủ bởi các gate clean install,
audit và build docs production. Hãy xem xét lại override khi upstream có tổ hợp ổn định, được hỗ trợ
và sạch audit.
