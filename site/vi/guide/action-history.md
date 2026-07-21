# Lịch sử thao tác {#action-history}

Lịch sử thao tác lưu các bản chụp CREATE, UPDATE và DELETE theo phạm vi tenant. Cơ chế này tách biệt với
các trường kiểm toán của bản ghi hiện tại do `WithAudit` cung cấp.

## Bật tính năng ghi và đọc an toàn {#enable-secure-recording-and-reads}

```ts
import { SdCoreModule } from '@sdcorejs/nestjs';

SdCoreModule.forRoot({
  actionHistory: {
    resolveActor: (context) => {
      const user = context.user as {
        email?: string;
        displayName?: string;
      } | undefined;
      return {
        userId: context.userId,
        username: user?.email,
        fullName: user?.displayName,
      };
    },
    authorizeRead: ({ context, tenantCode }) =>
      context.tenant === tenantCode &&
      context.permissions?.includes('history:read') === true,
    redactFields: ['customer.taxId', 'payment.cardLastFour'],
    maxPageSize: 50,
    retentionDays: 365,
  },
});
```

Đăng ký `ActionHistory` với TypeORM thông qua `autoLoadEntities: true` hoặc danh sách entity tường minh
và một migration. Nếu bỏ qua `authorizeRead`, mọi yêu cầu đọc đều bị từ chối.

`retentionDays` là gợi ý dành cho vận hành/tài liệu. Thư viện không xóa lịch sử kiểm toán;
hãy triển khai và phê duyệt chính sách lưu giữ trong ứng dụng sử dụng thư viện theo yêu cầu tuân thủ.

## Lịch sử repository tự động {#automatic-repository-history}

Bật `logHistory` trong một repository cụ thể:

```ts
super(Product, dataSource, {
  contextService: context,
  tenancyStrategy: tenancy,
  auditStrategy: audit,
  logHistory: true,
});
```

Đây là dòng cuối cùng trong constructor của `BaseRepository`; constructor đầy đủ được trình bày tại
[Các lớp cơ sở ORM](/vi/guide/orm-base-classes).

Theo mặc định, module lịch sử thao tác đăng ký `ActionHistoryService` làm bộ ghi dùng chung cho toàn tiến trình.
Lịch sử repository sử dụng `tablePath` ổn định, có schema của TypeORM, sao chép phạm vi từ
tài nguyên đã được lưu và ghi qua transaction thay đổi đang hoạt động.

Đối với tài nguyên có phạm vi, mọi trường phạm vi phải có trong bản ghi đã lưu. Khi thiếu trường phạm vi,
`MissingHistoryResourceScopeError` được ném ra trước khi commit. Theo mặc định, lịch sử gán tenant
bằng `resourceScope.tenantCode`.

Nếu entity dùng một thuộc tính tenant khác, hãy cấu hình một resolver đồng bộ:

```ts
resolveResourceTenant: ({ resourceScope }) =>
  typeof resourceScope.organizationCode === 'string'
    ? resourceScope.organizationCode
    : undefined,
```

Nếu không trả về tenant đáng tin cậy, `MissingActionHistoryResourceTenantError` sẽ được ném ra. Resolver
xung đột với `tenantCode` hiện có cũng bị từ chối.

## Ghi bản ghi thủ công {#manual-records}

```ts
import { Injectable } from '@nestjs/common';
import {
  ActionHistoryService,
  ActionHistoryType,
} from '@sdcorejs/nestjs/features';

@Injectable()
class ApprovalHistory {
  constructor(private readonly history: ActionHistoryService) {}

  recordApproval(orderId: string, before: unknown, after: unknown) {
    return this.history.create({
      table: 'public.order',
      tableId: orderId,
      type: ActionHistoryType.UPDATE,
      fromData: before,
      toData: after,
      note: 'Approval state changed',
    });
  }
}
```

Thao tác ghi thủ công cần một tenant đáng tin cậy trong `ContextService`. Nên ưu tiên tính năng ghi tự động
của repository khi hàng lịch sử phải commit nguyên tử cùng với thay đổi tài nguyên.

## API đọc {#read-api}

```ts
const page = await history.all({
  table: dataSource.getMetadata(Product).tablePath,
  tableId: productId,
  pageNumber: 0,
  pageSize: 25,
});
```

Đoạn mã tập trung này giả định đã inject `history: ActionHistoryService`, có `dataSource` của TypeORM,
entity `Product` và UUID `productId` từ mã ứng dụng.

Thao tác đọc yêu cầu tenant + đường dẫn bảng chính xác + UUID + sự chấp thuận rõ ràng từ policy. Tài nguyên thiếu,
sai định dạng, khác tenant hoặc bị từ chối đều trả về cùng một 404. Trang được đánh số từ 0, sắp xếp mới nhất trước
và bị giới hạn bởi `maxPageSize` đã cấu hình; giới hạn tuyệt đối là 200 và offset cơ sở dữ liệu cũng được giới hạn.

## Gắn controller một cách tường minh {#mount-the-controller-explicitly}

```ts
import { Module } from '@nestjs/common';
import { ActionHistoryController } from '@sdcorejs/nestjs/features';

@Module({
  controllers: [ActionHistoryController],
})
export class HistoryHttpModule {}
```

Controller không được tự động đăng ký. Nó cung cấp
`GET /action-history/:table/:tableId?pageNumber=0&pageSize=50`, trả về 200 cùng data envelope tiêu chuẩn,
sử dụng `AuthGuard` và vẫn ủy quyền kiểm tra tài nguyên cho `authorizeRead`.

## Che dữ liệu và các giới hạn {#redaction-and-limits}

Trước khi lưu, các bản chụp lần lượt đi qua:

1. `redactSnapshot` tùy chọn của ứng dụng;
2. cơ chế che dữ liệu theo đường dẫn chính xác/có dấu chấm đã cấu hình;
3. cơ chế che tên bí mật tích hợp theo kiểu đệ quy.

Các tên trường phổ biến về password, token, secret, authorization, API/access/private-key và credential
được che ngay cả khi lồng nhau. Chu trình được thay thế an toàn. Các giới hạn phòng vệ cố định gồm độ sâu 32,
10.000 node và 1 MiB dữ liệu UTF-8 đã duyệt; vượt giới hạn sẽ ném
`ActionHistorySnapshotLimitError` trước khi lưu.

Không được xem việc che dữ liệu là cấp quyền. Bản chụp có thể chứa dữ liệu nghiệp vụ nhạy cảm khác, vì vậy hãy giữ
`authorizeRead` theo từng tài nguyên và kiểm toán quyền truy cập endpoint lịch sử.
