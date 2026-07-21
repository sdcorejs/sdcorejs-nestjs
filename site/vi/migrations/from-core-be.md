# Migration từ `core-be` {#migrate-from-core-be}

Hướng dẫn đầy đủ về import/entity/operator được duy trì tại
[docs/migration-from-core-be.md](https://github.com/sdcorejs/sdcorejs-nestjs/blob/main/docs/migration-from-core-be.md).

Hãy xem đây là hai migration tách biệt:

1. Chuyển các import legacy và hạ tầng base dành riêng cho domain sang tám entry point
   `@sdcorejs/nestjs` được hỗ trợ, các chiến lược DI, decorator và feature entity.
2. Áp dụng mọi invariant bảo mật của 1.1.0 trong [hướng dẫn 1.0 → 1.1](/vi/migrations/1.0-to-1.1), ngay cả
   khi ứng dụng chưa từng phát hành với package phiên bản 1.0.

Không ánh xạ một cách máy móc các tenant header legacy, raw repository, boolean bypass, public
storage key, cache không có scope hoặc job lock theo kiểu kiểm tra-rồi-insert. Đây là các thay đổi ở
ranh giới tin cậy, đòi hỏi quyết định từ ứng dụng và migration test.
