# Permission {#permissions}

`AuthGuard` thực hiện hai bước: Passport xác minh strategy `jwt`, sau đó
`IPermissionStrategy` đã cấu hình tải và kiểm tra permission của route. Strategy mặc định không trả về
permission nào, vì vậy route có decorator sẽ từ chối truy cập cho đến khi ứng dụng cung cấp policy.

## Triển khai permission strategy {#implement-a-permission-strategy}

```ts
import { Injectable } from '@nestjs/common';
import type { IPermissionStrategy } from '@sdcorejs/nestjs/auth';
import type { RequestContext } from '@sdcorejs/nestjs/core';

@Injectable()
export class AppPermissionStrategy implements IPermissionStrategy {
  async load(context: RequestContext): Promise<string[]> {
    if (!context.userId || !context.tenant) return [];

    // Replace this line with your repository/authorization service.
    return ['tenant:' + context.tenant + ':product:read'];
  }

  check(codes: string[], required: string): boolean {
    return codes.includes(required) ||
      codes.some((code) =>
        code.endsWith(':*') && required.startsWith(code.slice(0, -1)),
      );
  }
}
```

Đăng ký class:

```ts
import { SdCoreModule } from '@sdcorejs/nestjs';

SdCoreModule.forRoot({
  permission: { strategy: AppPermissionStrategy },
});
```

`load()` được gọi tối đa một lần cho mỗi request khi có permission metadata. Các code kết quả
được đồng bộ vào `ContextService.permissions`, vì vậy mã downstream có thể gọi
`context.hasPermission(code)`.

## Bảo vệ route {#protect-routes}

```ts
import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  AuthGuard,
  HasAnyPermission,
  HasPermission,
} from '@sdcorejs/nestjs/auth';

@Controller('products')
@UseGuards(AuthGuard)
export class ProductQueryController {
  @Get()
  @HasPermission('product:read')
  list() {
    return [];
  }

  @Get('export')
  @HasAnyPermission('product:export', 'product:admin')
  exportRows() {
    return [];
  }
}
```

`HasAnyPermission` sử dụng ngữ nghĩa OR. Metadata của handler override metadata của class vì guard
dùng `getAllAndOverride` của Nest; hãy lặp lại yêu cầu cấp class trên handler được override khi
đó là policy bạn mong muốn.

## Hành vi danh tính và status {#identity-and-status-behavior}

- JWT thiếu, không hợp lệ hoặc hết hạn: Passport trả về 401.
- Principal đã xác minh nhưng không thể ánh xạ sang `userId` hợp lệ: 401.
- Xung đột giữa danh tính JWT đã xác minh và danh tính gateway đáng tin cậy: 401.
- Thiếu permission bắt buộc: 403 với code `core.permission.forbidden`.

Chạy validation sau xác thực:

```ts
import { Controller, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@sdcorejs/nestjs/auth';
import { ZodValidationGuard } from '@sdcorejs/nestjs/validation';
import { z } from 'zod';

const CreateProductSchema = z.object({ name: z.string().min(1) });

@Controller('products')
export class CreateProductController {
  @Post()
  @UseGuards(AuthGuard, ZodValidationGuard(CreateProductSchema))
  create() {
    return { accepted: true };
  }
}
```

Thứ tự này ngăn chi tiết validation bị lộ cho caller chưa xác thực.

## Tương tác với cache {#cache-interaction}

Phạm vi cache user và tenant tạo fingerprint cho permission và role. Nếu authorization backend
có thể thay đổi permission trong thời gian sống của token/session, hãy đặt một `permissionVersion` ổn định trong
danh tính đã phân giải và cập nhật nó mỗi khi trạng thái permission thay đổi.
