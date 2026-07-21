# Lịch sử thao tác {#action-history}

Công thức này ghi lại mutation của Product trong cùng transaction cơ sở dữ liệu và cung cấp endpoint
lịch sử đã xác thực, được phân quyền theo resource. Nó dùng lại `Product` và `ProductRepository` từ
[ứng dụng hoàn chỉnh](/vi/examples/complete-app), bao gồm cấu hình JWT, context, tenancy và TypeORM.

## Cấu hình tính năng {#configure-the-feature}

```ts
import { SdCoreModule } from '@sdcorejs/nestjs';

SdCoreModule.forRoot({
  actionHistory: {
    resolveActor: (context) => {
      const principal = context.user as {
        email?: string;
        displayName?: string;
      } | undefined;
      return {
        userId: context.userId,
        username: principal?.email,
        fullName: principal?.displayName,
      };
    },
    authorizeRead: ({ context, tenantCode, table }) =>
      context.tenant === tenantCode &&
      table === 'public.product' &&
      context.permissions?.includes('product:history:read') === true,
    redactFields: ['costPrice', 'supplier.apiToken'],
    maxPageSize: 50,
    retentionDays: 365,
  },
});
```

Gộp các option `actionHistory` này vào root call hiện có; không đăng ký `SdCoreModule` thứ hai.
Fragment độc lập giúp các option dễ đọc hơn.

`public.product` là một `tablePath` TypeORM minh họa; dùng
`dataSource.getMetadata(Product).tablePath` khi xây dựng policy trong ứng dụng để các thay đổi naming
strategy/schema vẫn chính xác. Bỏ `authorizeRead` sẽ từ chối mọi lần đọc.

Constructor của repository phải có `logHistory: true`. Tính năng đăng ký recorder của nó theo mặc
định, và snapshot CREATE/UPDATE/DELETE có scope dùng scope được sao chép từ hàng đã lưu.

## Property tenant tùy chỉnh {#custom-tenant-property}

Nếu entity áp dụng scope bằng `organizationCode` thay vì `tenantCode`, hãy ánh xạ rõ ràng:

```ts
resolveResourceTenant: ({ resourceScope }) =>
  typeof resourceScope.organizationCode === 'string'
    ? resourceScope.organizationCode
    : undefined,
```

Fragment này thuộc các option `actionHistory`. Việc gán tenant bị thiếu hoặc xung đột sẽ thất bại
trước khi mutation resource được commit.

## Mount controller đọc {#mount-the-read-controller}

```ts
import { Module } from '@nestjs/common';
import { ActionHistoryController } from '@sdcorejs/nestjs/features';

@Module({
  controllers: [ActionHistoryController],
})
export class HistoryHttpModule {}
```

Controller không được tự động mount. Nó cung cấp:

```http
GET /action-history/public.product/6e71382b-45e5-4f92-98f3-13bf48ae2f5e?pageNumber=0&pageSize=25
Authorization: Bearer <token>
```

Response có HTTP 200 với nội dung:

```json
{
  "data": {
    "items": [
      {
        "id": "history-uuid",
        "tenantCode": "ACME",
        "table": "public.product",
        "tableId": "6e71382b-45e5-4f92-98f3-13bf48ae2f5e",
        "type": "UPDATE",
        "fromData": { "name": "Old", "costPrice": "[REDACTED]" },
        "toData": { "name": "New", "costPrice": "[REDACTED]" },
        "createdAt": "2026-07-20T00:00:00.000Z"
      }
    ],
    "total": 1
  }
}
```

`history-uuid` chỉ để minh họa; ID được lưu là UUID. Resource bị thiếu, sai định dạng, không được
phép và khác tenant đều trả cùng mã 404.

## Domain event thủ công {#manual-domain-event}

```ts
import { Injectable } from '@nestjs/common';
import {
  ActionHistoryService,
  ActionHistoryType,
} from '@sdcorejs/nestjs/features';

@Injectable()
class ApprovalAudit {
  constructor(private readonly history: ActionHistoryService) {}

  record(orderId: string, before: unknown, after: unknown) {
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

`create()` thủ công yêu cầu tenant context đáng tin cậy. Ưu tiên ghi qua repository khi lịch sử phải
commit nguyên tử cùng hàng domain.

## Retention và bảo mật {#retention-and-security}

`retentionDays` không xóa hàng. Hãy triển khai một compliance job được phê duyệt riêng. Redaction
tích hợp và đã cấu hình chạy trước khi lưu, nhưng không thể nhận diện mọi field nghiệp vụ nhạy cảm;
hãy giữ snapshot tối thiểu và read policy theo từng resource.
