# Tổng quan tính năng {#feature-overview}

Package có ba feature module dựa trên PostgreSQL cùng phần tích hợp BullMQ.

| Tính năng | Cách bật | API chính | HTTP controller |
| --- | --- | --- | --- |
| File tải lên | `uploadedFile: {...}` | `UploadedFileService` | private, bật theo nhu cầu |
| Lịch sử thao tác | `actionHistory: {...}` | `ActionHistoryService` | private, bật theo nhu cầu |
| Job scheduler | `jobScheduler: {}` | `JobSchedulerService` | không có |
| Hàng đợi BullMQ | `queue: {...}` hoặc `QueueModule` | `Queue`, `SdWorkerHost` | không có |

## Thiết lập dùng chung {#shared-setup}

File tải lên, lịch sử thao tác và job scheduler export các entity TypeORM từ
`@sdcorejs/nestjs/features`. Đăng ký chúng bằng `autoLoadEntities: true` hoặc liệt kê tường minh,
sau đó tạo migration của ứng dụng.

```ts
import { SdCoreModule } from '@sdcorejs/nestjs';

SdCoreModule.forRoot({
  uploadedFile: {
    driver: 'local',
    localRoot: './var/uploads',
    cleanupAfterDays: 7,
  },
  actionHistory: {
    authorizeRead: ({ context, tenantCode }) =>
      context.tenant === tenantCode &&
      context.permissions?.includes('history:read') === true,
  },
  jobScheduler: {},
  queue: {
    connection: { host: 'localhost', port: 6379, db: 1 },
    prefix: 'orders:dev:queue',
  },
});
```

## Mô hình bảo mật {#security-model}

- [File tải lên](/vi/guide/uploaded-files) sử dụng phạm vi tenant/department/owner, khóa được tạo tự động, input có giới hạn,
  cơ chế lưu pending-first, xóa bền vững và response không để lộ khả năng liệt kê.
- [Lịch sử thao tác](/vi/guide/action-history) ràng buộc thao tác đọc với tenant + danh tính tài nguyên + policy tường minh
  và che secret theo kiểu đệ quy trước khi lưu.
- [Job scheduler](/vi/guide/job-scheduler) rào quyền sở hữu lease nhưng ủy quyền tính idempotent bên ngoài cho
  một `lease.idempotencyKey` ổn định.
- [BullMQ](/vi/guide/queue) cung cấp công việc/retry bền vững nhưng yêu cầu handler có tính idempotent.

Controller file tải lên và lịch sử thao tác không được tự động đăng ký. Việc thêm class của chúng vào
mảng `controllers` trong module ứng dụng sẽ chủ động cung cấp các route đã xác thực đó.
