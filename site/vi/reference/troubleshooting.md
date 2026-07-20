# Khắc phục sự cố {#troubleshooting}

## Repository có scope báo lỗi ngay ở query đầu tiên {#scoped-repository-throws-at-first-query}

`MissingTenancyContextError` nghĩa là entity có scope không có tenancy strategy đang active. Import
`TenancyModule`/cấu hình `SdCoreModule.tenancy`, sau đó đảm bảo request nằm trong
`ContextMiddleware`. `MissingTenancyScopeError` nghĩa là strategy đã bỏ sót một property
`@Scoped()` bắt buộc; không chuyển lỗi đó thành query không có scope.

## `@Cached()` không có tác dụng {#cached-does-nothing}

Decorator chỉ lưu metadata. Đăng ký `CacheInterceptor` toàn cục với `APP_INTERCEPTOR` hoặc áp dụng
`@UseInterceptors(CacheInterceptor)` cho controller. Sau đó kiểm tra method trả về một giá trị (không
phải stream) và scope đã khai báo có đủ context đáng tin cậy bắt buộc.

## Redis khởi động thất bại vì prefix không hợp lệ {#redis-startup-fails-with-an-invalid-prefix}

Đặt `cache.redis.keyPrefix` riêng, không rỗng và không chứa `*`, `?`, `[`, `]` hoặc dấu gạch chéo
ngược. Lỗi này ngăn một ứng dụng scan/xóa key của ứng dụng khác.

## JWKS strategy thất bại khi khởi tạo {#jwks-strategy-fails-during-construction}

Khai báo ít nhất một issuer policy: `allowedIssuers` chính xác, origin đáng tin cậy trong
`allowedIssuerHosts` hoặc một `issuerValidator`. Cấu hình `jwks` hoặc `secret`, không bao giờ cả hai.
Cài `jwks-rsa` và `jsonwebtoken` khi quá trình cài dependency tùy chọn đã bị tắt.

## Xác thực cookie hoạt động với bearer nhưng không hoạt động trên request trình duyệt {#cookie-authentication-works-for-bearer-but-not-browser-requests}

Đặt `cookieName` không rỗng; cơ chế trích xuất bearer có độ ưu tiên cao hơn và cookie được đặt tên là
fallback trong cả strategy đối xứng lẫn JWKS. HTTP adapter của bạn phải điền `request.cookies` (ví
dụ bằng cookie-parser). Thư viện không tự parse header Cookie.

## S3 bất ngờ dùng local storage {#s3-unexpectedly-uses-local-storage}

Đặt `driver: 's3'` và `bucket` không rỗng. Dùng default provider chain của AWS bằng cách bỏ cả
`accessId` lẫn `accessKey`, hoặc cấu hình cả hai thành chuỗi không rỗng. Credential một phần/rỗng sẽ
gây lỗi khi cấu hình module. Một local driver được chỉ định rõ có thể giữ lại bộ S3 hoàn chỉnh nhưng
không hoạt động.

## Upload trả về 400 nhưng object có thể đã tồn tại {#upload-returned-400-but-an-object-may-exist}

Service giữ hàng cơ sở dữ liệu ở trạng thái pending và bị ẩn cho đến khi activation. Chạy worker
maintenance pending-deletion đáng tin cậy; không xóa key tùy ý lấy từ request input. Kiểm tra log và
đối soát object inventory với key trong cơ sở dữ liệu nếu sự cố đi qua cả hai hệ thống.

## Job đã lên lịch chạy lại sau sự cố {#scheduled-job-runs-again-after-a-crash}

Stale lease được phép reclaim theo thiết kế. Dùng `idempotencyKey` ổn định trong callback cho outbox
hoặc deduplication downstream. Không dùng `ownerToken` làm khóa idempotency nghiệp vụ; nó xoay vòng
sau mỗi lần reclaim.

## Package import hoặc định danh DI thất bại {#package-import-or-di-identity-fails}

Dùng một trong tám import đã được tài liệu hóa, giữ các phiên bản Nest/TypeORM tương thích được
hoist và tránh deep import `/dist`. Chạy `npm ls`, export check của package và DI smoke test trong
một bản cài đặt sạch.
