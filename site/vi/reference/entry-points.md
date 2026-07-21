# Entry point {#entry-points}

Package cung cấp chính xác tám đường dẫn import được hỗ trợ. Hãy dùng đường dẫn hẹp nhất sở hữu API
bạn cần. Deep import trỏ đến nội bộ của bản build và không thuộc hợp đồng tương thích.

| Import | Trách nhiệm chính | Symbol thường dùng đầu tiên |
| --- | --- | --- |
| `@sdcorejs/nestjs` | Composition và các primitive xuyên suốt dùng chung | `SdCoreModule` |
| `@sdcorejs/nestjs/core` | ORM, request context, tenancy, audit | `BaseRepository` |
| `@sdcorejs/nestjs/auth` | JWT/JWKS, kiểm tra permission, lời gọi nội bộ | `JwtModule` |
| `@sdcorejs/nestjs/services` | Cache và HTTP đi | `CacheModule` |
| `@sdcorejs/nestjs/validation` | Parse và guard Zod v4 | `ZodValidationGuard` |
| `@sdcorejs/nestjs/queue` | Module BullMQ và adapter worker | `QueueModule` |
| `@sdcorejs/nestjs/i18n` | Catalog, phân giải ngôn ngữ, exception filter | `I18nModule` |
| `@sdcorejs/nestjs/features` | Tệp, lịch sử thao tác, job lease phân tán | `UploadedFileModule` |

Cả `import` và `require` đều phân giải đến đầu ra ESM/CJS riêng với declaration tương ứng. Không
import các đường dẫn như `@sdcorejs/nestjs/orm`, `/cache`, `/jwt` hoặc file mã nguồn bên dưới `/dist`.

```ts
import { SdCoreModule } from '@sdcorejs/nestjs';
import { BaseEntity, BaseRepository, Scoped, WithAudit } from '@sdcorejs/nestjs/core';
import { AuthGuard, HasPermission, JwtModule } from '@sdcorejs/nestjs/auth';
import { CacheModule, HttpClientModule } from '@sdcorejs/nestjs/services';
```

Xem [danh mục API](/vi/api/) để biết mọi value và type được export bởi từng đường dẫn.

## Runtime tùy chọn {#optional-runtimes}

Dependency tùy chọn được npm cài đặt theo kiểu không gây lỗi, nhưng ứng dụng chỉ cần runtime cho
tính năng mà nó bật:

| Tính năng | Runtime |
| --- | --- |
| Cache Redis / kết nối BullMQ | `ioredis` |
| Xác minh OIDC/JWKS | `jwks-rsa` và `jsonwebtoken` |
| Driver S3 cho tệp đã tải lên | `@aws-sdk/client-s3` |

Runtime tùy chọn bị thiếu sẽ gây lỗi khi tính năng tương ứng được khởi tạo hoặc dùng lần đầu; chúng
không thay đổi đường dẫn import công khai. Zod v4 là dependency bắt buộc vì helper validation được
export từ cả root và entry point `/validation`.
