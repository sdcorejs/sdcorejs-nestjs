# Trường kiểm toán và lịch sử thay đổi {#audit-fields-and-change-history}

Hai cơ chế liên quan phục vụ các mục đích khác nhau:

- `WithAudit(BaseEntity)` thêm các cột kiểm toán hiện tại vào một hàng dữ liệu miền.
- tính năng lịch sử thao tác lưu một dòng thời gian gồm các bản chụp trước/sau.

## Các cột kiểm toán {#audit-columns}

`WithTimestamps(BaseEntity)` thêm `createdAt`, `updatedAt` và `deletedAt`.
`WithAudit(BaseEntity)` bao gồm các cột đó cùng với `createdBy`, `modifiedBy`, `creator` và
`modifier`.

```ts
import { Column, Entity } from 'typeorm';
import { BaseEntity, WithAudit } from '@sdcorejs/nestjs/core';

@Entity('customer')
export class Customer extends WithAudit(BaseEntity) {
  @Column()
  name!: string;
}
```

Audit strategy mặc định điền `createdBy` và `modifiedBy` từ `ContextService.userId`. Nó
không tự tạo các bản chụp người dùng theo miền cho các cột jsonb `creator` và `modifier`.

## Strategy tùy chỉnh {#custom-strategy}

```ts
import { Injectable } from '@nestjs/common';
import type { DeepPartial } from 'typeorm';
import type {
  IAuditStrategy,
  RequestContext,
  UserSnapshot,
} from '@sdcorejs/nestjs/core';

@Injectable()
export class AppAuditStrategy implements IAuditStrategy {
  onCreate(entity: DeepPartial<Record<string, unknown>>, context: RequestContext): void {
    if (!context.userId) return;
    entity.createdBy = context.userId;
    entity.modifiedBy = context.userId;
    const principal = context.user as { email?: string; displayName?: string } | undefined;
    const snapshot: UserSnapshot = {
      id: context.userId,
      username: principal?.email ?? context.userId,
      fullName: principal?.displayName ?? '',
    };
    entity.creator = snapshot;
    entity.modifier = snapshot;
  }

  onUpdate(entity: DeepPartial<Record<string, unknown>>, context: RequestContext): void {
    if (context.userId) entity.modifiedBy = context.userId;
  }

  onSoftDelete(): void {}
}
```

Đăng ký bằng `audit: { strategy: AppAuditStrategy }` và truyền strategy đã inject vào từng
`BaseRepository` cần điền các trường này.

## Ghi trực tiếp bằng TypeORM {#direct-typeorm-writes}

`BaseRepository.create/update/import` gọi trực tiếp strategy đã cấu hình. Các thao tác ghi thực hiện
qua repository TypeORM thông thường cần thêm `AuditSubscriber` vào `DataSource` đang hoạt động:

```ts
import { DataSource } from 'typeorm';
import { AuditSubscriber } from '@sdcorejs/nestjs/core';

const subscriber = app.get(AuditSubscriber);
const dataSource = app.get(DataSource);
if (!dataSource.subscribers.includes(subscriber)) {
  dataSource.subscribers.push(subscriber);
}
```

Đoạn mã này nằm trong phần bootstrap sau khi tạo `app` và trước khi bắt đầu ghi. Subscriber chỉ tác động
đến các entity được tạo bằng `WithAudit`.

## Lịch sử bản chụp {#snapshot-history}

Đặt `logHistory: true` trong repository và bật `actionHistory` để lưu các bản chụp CREATE, UPDATE và
DELETE bên trong transaction thay đổi. Policy đọc, che dữ liệu, lưu giữ và cách gắn controller
được trình bày trong [Lịch sử thao tác](/vi/guide/action-history).
