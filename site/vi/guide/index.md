# Hướng dẫn {#guide}

`@sdcorejs/nestjs` đóng gói hạ tầng mà các service NestJS đa tenant thường xuyên cần:
request context, thực thi tenancy, trường kiểm toán, permission, xác minh JWT, cache, HTTP client outbound an toàn,
validation, i18n, lưu trữ file, lịch sử thao tác, job lease phân tán và tích hợp BullMQ.

Thư viện cung cấp các cơ chế. Ứng dụng của bạn vẫn chịu trách nhiệm về policy miền: cách ánh xạ một
principal đã xác minh thành user và tenant, họ có permission nào, có thể xem bản ghi nào và
side effect bên ngoài nào có tính idempotent.

## Chọn lộ trình {#choose-a-path}

- Dự án mới: [Cài đặt](/vi/guide/installation) → [Cấu hình](/vi/guide/configuration) →
  [Ứng dụng hoàn chỉnh](/vi/examples/complete-app).
- CRUD đa tenant: [Request context](/vi/guide/request-context) →
  [Multi-tenancy](/vi/guide/multi-tenancy) → [Các lớp cơ sở ORM](/vi/guide/orm-base-classes).
- Xác thực: [JWT và Keycloak](/vi/guide/jwt-keycloak) →
  [Ví dụ danh tính và permission](/vi/examples/identity-and-permissions).
- Tính năng có trạng thái: [File tải lên](/vi/guide/uploaded-files),
  [lịch sử thao tác](/vi/guide/action-history) và [job scheduler](/vi/guide/job-scheduler).
- Review production: [Cơ sở dữ liệu và PostgreSQL](/vi/guide/database) và hướng dẫn migration bảo mật
  1.1.0 được liên kết từ navigation tài liệu.

## Public import {#public-imports}

Chỉ sử dụng package root và bảy subpath đã được ghi trong tài liệu:

```ts
import { SdCoreModule } from '@sdcorejs/nestjs';
import { BaseRepository, ContextService } from '@sdcorejs/nestjs/core';
import { AuthGuard, HasPermission } from '@sdcorejs/nestjs/auth';
import { CacheService, HttpService } from '@sdcorejs/nestjs/services';
import { ZodValidationGuard } from '@sdcorejs/nestjs/validation';
import { QueueModule } from '@sdcorejs/nestjs/queue';
import { I18N_RESOLVER } from '@sdcorejs/nestjs/i18n';
import { UploadedFileService } from '@sdcorejs/nestjs/features';
```

Deep import vào `dist`, `src` hoặc thư mục nội bộ của một feature không thuộc hợp đồng tương thích.
