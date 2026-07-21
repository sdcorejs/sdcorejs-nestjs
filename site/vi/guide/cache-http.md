# Cache và HTTP {#cache-and-http}

Trang tương thích này trỏ đến các hướng dẫn chi tiết hơn:

- [Cache](/vi/guide/cache): cấu hình backend, đăng ký `CacheInterceptor` bắt buộc, phạm vi cache,
  namespace Redis và cách dùng `CacheService` tường minh.
- [HTTP outbound](/vi/guide/outbound-http): origin đáng tin cậy chính xác, truyền danh tính, redirect và
  ví dụ client.

Cả hai tính năng đều phụ thuộc vào danh tính request. Hãy đọc [Request context](/vi/guide/request-context) trước khi
chia sẻ giá trị cache hoặc truyền header giữa các service.
