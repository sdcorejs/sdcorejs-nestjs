# API core {#core-api}

Đường dẫn import: `@sdcorejs/nestjs/core`

Entrypoint core gồm bốn bề mặt phối hợp với nhau:

- [ORM](./orm.md) — entity/mixin TypeORM, repository, service, controller, kiểu query và cầu nối
  history.
- [Request context](./context.md) — AsyncLocalStorage và ánh xạ danh tính tin cậy.
- [Multi-tenancy](./tenancy.md) — decorator scope, strategy, thực thi fail-closed và grant đặc quyền
  có audit.
- [Audit](./audit.md) — strategy cho trường actor và subscriber TypeORM.

## Luồng điển hình {#typical-flow}

```text
verified JWT principal
  -> ContextService identity
  -> tenancy/audit strategies
  -> BaseRepository scoped query or mutation
  -> optional ActionHistory recorder
```

```ts
import {
  BaseEntity,
  BaseRepository,
  ContextService,
  Scoped,
  WithAudit,
  type ITenancyStrategy,
} from '@sdcorejs/nestjs/core';
```

Bắt đầu với [ORM](./orm.md) để xem ví dụ entity/repository/service/controller hoàn chỉnh. Mỗi entity
có scope cũng phải tuân theo [cấu hình tenancy](./tenancy.md); thiếu scope bắt buộc sẽ fail closed
thay vì fallback về dữ liệu global.

## Cơ sở dữ liệu đích {#database-target}

Lớp query và các kiểu cột tích hợp nhắm tới PostgreSQL. Tìm kiếm văn bản phụ thuộc vào `unaccent`,
đường dẫn JSON dùng operator PostgreSQL, import dùng `RETURNING`, và việc sắp xếp chỉ định vị trí
null. Xem [Hành vi PostgreSQL](./orm.md#postgresql-behavior) trước khi chọn datasource engine.
