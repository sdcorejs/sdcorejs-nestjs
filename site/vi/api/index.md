# Tham chiếu API {#api-reference}

Phần tham chiếu này mô tả các export công khai của `@sdcorejs/nestjs`. Hãy import từ entrypoint
hẹp nhất sở hữu API; package root chủ ý chỉ công khai module bootstrap và các contract tích hợp
phổ biến nhất.

## Các entrypoint công khai {#public-entrypoints}

| Đường dẫn import | Nội dung |
| --- | --- |
| [`@sdcorejs/nestjs`](./root.md) | `SdCoreModule`, cấu hình root, các DI token dùng chung, guard, helper response và validation |
| [`@sdcorejs/nestjs/core`](./core/orm.md) | Các lớp cơ sở TypeORM, request context, tenancy và audit |
| [`@sdcorejs/nestjs/auth`](./auth/jwt.md) | JWT đối xứng, JWKS/OIDC, permission và guard cho lời gọi nội bộ |
| [`@sdcorejs/nestjs/services`](./services/cache.md) | Backend/interceptor cache và HTTP client cho origin tin cậy |
| [`@sdcorejs/nestjs/validation`](./validation.md) | Phân tích Zod, request guard và các preset query |
| [`@sdcorejs/nestjs/i18n`](./i18n.md) | Phân giải ngôn ngữ, catalog và bản địa hóa exception |
| [`@sdcorejs/nestjs/queue`](./queue.md) | Bootstrap BullMQ, lớp worker cơ sở và các primitive của queue |
| [`@sdcorejs/nestjs/features`](./features/uploaded-files.md) | File tải lên, lịch sử thao tác và khóa job trong cơ sở dữ liệu |

## Quy tắc import {#import-rules}

```ts
// Common bootstrap API
import { SdCoreModule, ContextService } from '@sdcorejs/nestjs';

// Full specialist surfaces
import { BaseRepository, Scoped } from '@sdcorejs/nestjs/core';
import { KeycloakJwtStrategy } from '@sdcorejs/nestjs/auth';
import { CacheService } from '@sdcorejs/nestjs/services';
```

Tất cả entrypoint đều hỗ trợ ESM và CommonJS, đồng thời phát hành khai báo TypeScript riêng. Thư
viện yêu cầu Node.js 20 trở lên và NestJS 11.

## Các hành vi mặc định cần biết {#behavioral-defaults-worth-knowing}

- Trang của repository bắt đầu từ **0**. Khi thiếu `pageNumber`, giá trị trở thành `0`; khi thiếu
  hoặc `pageSize` không dương, giá trị trở thành `10`; giới hạn cứng là `200`.
- Entity TypeORM có scope sẽ fail closed khi không có tenancy context bắt buộc.
- `detail()` mặc định loại trừ các hàng đã soft-delete. Chỉ truyền `{ withDeleted: true }` trong
  luồng khôi phục/quản trị đã được cấp quyền.
- JWT là tính năng opt-in. Chế độ JWKS yêu cầu issuer policy; chế độ đối xứng yêu cầu `secret`.
- `@Cached()` không làm gì nếu `CacheInterceptor` chưa được đăng ký trên route/controller hoặc làm
  global interceptor.
- Phần tìm kiếm/lọc ORM và các feature entity có trạng thái tích hợp sẵn nhắm tới PostgreSQL. Xem
  [Hành vi PostgreSQL](./core/orm.md#postgresql-behavior).

## Quy ước response và error {#response-and-error-convention}

Các controller của thư viện trả về `{ data }`, còn HTTP error của thư viện mang body ổn định
`{ code, message, data? }`. Khi bật `I18nModule`, global filter sẽ chuyển các lỗi đó thành
`{ error: { code, message, data? } }`.

```ts
import { ApiResponse, apiError } from '@sdcorejs/nestjs';
import { BadRequestException } from '@nestjs/common';

return ApiResponse.ok({ id: '...' });
throw new BadRequestException(apiError('catalog.product.invalid', 'Invalid product'));
```

## Mô hình bảo mật {#security-model}

Các API phân biệt danh tính tin cậy với dữ liệu đầu vào transport không tin cậy. JWT claim chỉ trở
thành danh tính request sau khi Passport xác minh; identity header chỉ được chấp nhận qua chế độ
trusted-header đã được xác minh rõ ràng. Bộ lọc tenancy, chính sách truy cập file và quyền truy cập
lịch sử thao tác được thực thi trong service/repository, không chỉ trong controller. API có tiền tố
`unsafe` là lối thoát dành cho bảo trì hoặc truy cập cơ sở dữ liệu thô và không được công khai cho
request thông thường.
