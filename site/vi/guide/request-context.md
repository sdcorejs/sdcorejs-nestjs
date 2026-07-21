# Request context và danh tính {#request-context-and-identity}

`ContextModule` tạo một `RequestContext` cho mỗi HTTP request bằng
`AsyncLocalStorage` của Node. `ContextService` vẫn là singleton, vì vậy việc sử dụng nó không biến DI graph
của ứng dụng thành request scope.

```ts
import { Injectable } from '@nestjs/common';
import { ContextService } from '@sdcorejs/nestjs/core';

@Injectable()
export class PricingService {
  constructor(private readonly context: ContextService) {}

  quote() {
    return {
      tenant: this.context.tenant,
      userId: this.context.userId,
      currency: this.context.getCustom<string>('currency'),
    };
  }
}
```

## Những gì được điền trước khi xác thực {#what-is-populated-before-authentication}

Middleware luôn ghi lại language header thô, authorization header, request và response.
Nó không xem header danh tính thông thường là đáng tin cậy. Nếu không có chế độ trusted-gateway tường minh,
`X-Tenant`, `X-User-Id` và custom identity header đã cấu hình không điền các trường bảo mật.

Sau khi Passport xác minh JWT, `AuthGuard` ánh xạ `req.user` bằng
`principalResolver` đã cấu hình, thay thế nguyên tử các giá trị context nhạy cảm về bảo mật và đánh dấu nguồn là
`verified-principal`.

```ts
import type { TLSSocket } from 'node:tls';
import { SdCoreModule } from '@sdcorejs/nestjs';
import { z } from 'zod';

const AppPrincipalSchema = z.object({
  id: z.string().min(1),
  tenantCode: z.string().min(1).max(64),
  roleCodes: z.array(z.string().min(1)),
});

SdCoreModule.forRoot({
  context: {
    identity: {
      principalResolver: (principal: unknown) => {
        const user = AppPrincipalSchema.parse(principal);
        return {
          userId: user.id,
          tenant: user.tenantCode,
          roles: user.roleCodes,
        };
      },
    },
  },
});
```

Resolver phải trả về một `userId` không trống. Ném lỗi, trả về danh tính không hợp lệ hoặc truy cập một
route có guard mà không có `req.user` đều dẫn đến 401.

## Chế độ trusted gateway {#trusted-gateway-mode}

Chỉ dùng danh tính từ header khi ứng dụng có thể chứng minh request đã đi qua một ranh giới gateway đáng tin cậy.
Verifier phải validate yếu tố mà caller public không thể giả mạo, chẳng hạn mTLS peer đã xác minh,
địa chỉ proxy đáng tin cậy sau khi cấu hình proxy đúng hoặc signed-header envelope.

```ts
import { SdCoreModule } from '@sdcorejs/nestjs';

SdCoreModule.forRoot({
  context: {
    headers: {
      tenant: 'x-tenant',
      userId: 'x-user-id',
      customHeaders: { departmentCode: 'x-department-code' },
    },
    identity: {
      trustedHeaders: {
        isTrustedRequest: (request) =>
          (request.socket as TLSSocket).authorized === true,
      },
    },
  },
});
```

::: warning Cảnh báo
Đoạn mã giả định HTTPS/mTLS server của bạn đặt `request.socket.authorized`. Nếu hệ thống triển khai
không chấm dứt client certificate đã xác minh trong tiến trình NestJS, hãy triển khai verifier phù hợp
với ranh giới proxy thực tế. Không bao giờ trả về `true` vô điều kiện.
:::

Nếu có bất kỳ identity header đã cấu hình nào và việc xác minh thất bại, middleware sẽ từ chối
request với 401. Nếu danh tính header đáng tin cậy và principal được xác minh sau đó cung cấp các giá trị xung đột,
`AuthGuard` cũng từ chối với 401.

## Mở rộng context an toàn {#extending-context-safely}

Ưu tiên bag `custom` cho giá trị miền:

```ts
const department = context.getCustom<string>('departmentCode');
```

Declaration merging có thể dùng khi thuộc tính trực tiếp giúp mã thuận tiện hơn:

```ts
declare module '@sdcorejs/nestjs/core' {
  interface RequestContext {
    requestChannel?: 'web' | 'mobile';
  }
}
```

Consumer nhạy cảm về bảo mật như namespace cache kiểm tra các trường miền an toàn với JSON. Giữ giá trị context
ở dạng dữ liệu thuần, có giới hạn. Không lưu secret, kết nối cơ sở dữ liệu, class instance, chu trình hoặc
graph lớn trong `custom`.

## Công việc nền {#background-work}

Queue worker hoặc lệnh CLI không có HTTP middleware. Chỉ thiết lập context tường minh
khi công việc thực sự chạy thay mặt một tenant/user:

```ts
await context.run(
  { tenant: job.tenantCode, userId: job.actorId, identitySource: 'verified-principal' },
  () => applicationService.execute(job.payload),
);
```

Giá trị `identitySource` trong ví dụ này là một assertion của ứng dụng. Chỉ điền nó từ
dữ liệu job đã xác thực, được bảo vệ toàn vẹn; không bao giờ sao chép trực tiếp trường payload không đáng tin cậy.
