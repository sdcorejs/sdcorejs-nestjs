# Checklist bảo mật {#security-checklist}

Dùng danh sách này làm deployment gate; nó bổ sung cho
[chính sách bảo mật](https://github.com/sdcorejs/sdcorejs-nestjs/blob/main/SECURITY.md) của repository.

## Danh tính và phân quyền {#identity-and-authorization}

- Ánh xạ danh tính tenant/user từ principal Passport đã xác minh. Để danh tính từ header ở trạng
  thái tắt trừ khi `trustedHeaders.isTrustedRequest` xác minh một ranh giới gateway thật.
- Tại gateway, loại bỏ identity header của client trước khi ghi giá trị đáng tin cậy. Xem xung đột
  giữa danh tính principal và gateway là lỗi xác thực.
- Cấu hình issuer policy JWKS (`allowedIssuers`, `allowedIssuerHosts` hoặc `issuerValidator`) và giới
  hạn algorithm/audience. Không bao giờ cấu hình đồng thời `secret` đối xứng và `jwks`.
- Bảo vệ method resource bằng permission của ứng dụng. Chỉ xác thực không đồng nghĩa với phân quyền
  resource tệp/lịch sử.
- Nạp secret lời gọi nội bộ từ environment/provider, hỗ trợ rotation với `getKeys()` và chỉ chạy
  context enrichment sau khi `InternalGuard` thành công.

## Cơ sở dữ liệu và tenancy {#database-and-tenancy}

- Gắn `@Scoped()` cho mọi chiều scope trong cơ sở dữ liệu dùng chung; mặc định là bắt buộc.
- Đảm bảo mỗi repository có scope nhận một tenancy strategy và kiểm thử ma trận chéo
  tenant/user/department. Mảng giá trị được phép rỗng phải luôn có nghĩa là từ chối tất cả.
- Dùng bypass grant có cấu trúc, giới hạn theo target/operation và được audit đồng bộ. Boolean bypass
  không cấp quyền truy cập.
- Không để `unsafeRepository`, `unsafeGetRepository` và `unsafeCreateQueryRunner` trong request path.
- Dùng caller transaction đang active cho mutation nhiều bước có scope; xác minh số hàng bị tác động.

## Cache và HTTP {#cache-and-http}

- Đăng ký `CacheInterceptor` (`APP_INTERCEPTOR` hoặc `@UseInterceptors`) trước khi dựa vào `@Cached()`.
- Chọn cache scope tenant/user cho dữ liệu phụ thuộc danh tính. `global` chỉ dành cho kết quả public
  thực sự giống hệt nhau.
- Cấp cho Redis một prefix application/environment/release riêng, không rỗng và không chứa glob.
- Cấu hình chính xác origin HTTP(S) đáng tin cậy. Không truyền danh tính đến URL tùy ý, host gần
  giống, port khác hoặc redirect khác origin.

## Tệp, lịch sử và job {#files-history-and-jobs}

- Giữ storage riêng tư theo mặc định. Cấu hình S3 bucket không rỗng và dùng provider chain của SDK
  hoặc một cặp access key hoàn chỉnh, không rỗng.
- Giữ remote clone ở trạng thái tắt trừ khi cần; dùng allowlist host cùng giới hạn timeout/size/redirect
  chặt chẽ và outbound network policy.
- Chạy maintenance cho tệp pending và đối soát inventory storage/cơ sở dữ liệu. Không bao giờ expose
  method `unsafeSystem*` từ controller.
- Cấu hình phân quyền đọc lịch sử thao tác, phân giải tenant, redaction bắt buộc và quy trình retention
  do ứng dụng sở hữu.
- Dùng `JobExecutionLease.idempotencyKey` trong transactional outbox duy nhất hoặc
  `Idempotency-Key` ở downstream. Fencing bằng owner token không làm hiệu ứng bên ngoài thành exactly-once.

## Vận hành {#operations}

- Chạy các phiên bản Node.js và NestJS được hỗ trợ, áp dụng migration PostgreSQL rõ ràng, sao lưu
  trước khi đổi schema/object key và tắt đồng bộ TypeORM trên production.
- Chạy các gate package, test, export, docs, link, API coverage và dependency audit trước khi phát hành.
- Báo cáo lỗ hổng qua private security advisory của GitHub, không bao giờ qua issue công khai.
