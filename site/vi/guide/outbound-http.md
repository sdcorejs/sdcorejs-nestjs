# HTTP outbound {#outbound-http}

`HttpService` bọc Axios và trả về trực tiếp dữ liệu response. Header danh tính từ context chỉ được truyền
đến các origin HTTP(S) đáng tin cậy khớp chính xác.

## Cấu hình origin chính xác {#configure-exact-origins}

```ts
import { SdCoreModule } from '@sdcorejs/nestjs';

SdCoreModule.forRoot({
  context: {
    headers: {
      tenant: 'x-tenant',
      userId: 'x-user-id',
      customHeaders: { departmentCode: 'x-department-code' },
    },
  },
  http: {
    baseURL: 'https://inventory.internal.example',
    timeout: 10_000,
    trustedOrigins: ['https://inventory.internal.example'],
  },
});
```

Origin được chuẩn hóa bằng URL parser. Path bị bỏ qua; scheme, hostname và effective port
phải khớp. Subdomain, tên giả mạo, port thay thế, giao thức không phải HTTP và URL tuyệt đối tùy ý
không được xem là khớp.

Trước mỗi request, client loại bỏ các header danh tính đã cấu hình do caller cung cấp. Với một
origin đáng tin cậy, client tạo lại chúng từ `ContextService`; với origin không đáng tin cậy, các header này
vắng mặt. Redirect áp dụng lại cùng quyết định ở mỗi đích.

`Authorization` vẫn do caller sở hữu. `x-internal-secret` cũng vẫn do caller cung cấp, nhưng bị
loại bỏ khỏi request và redirect không đáng tin cậy.

## Sử dụng client {#use-the-client}

```ts
import { Injectable } from '@nestjs/common';
import { HttpService } from '@sdcorejs/nestjs/services';

interface InventoryItem {
  id: string;
  available: boolean;
}

@Injectable()
class InventoryClient {
  constructor(private readonly http: HttpService) {}

  detail(id: string): Promise<InventoryItem> {
    return this.http.get<InventoryItem>('/items/' + encodeURIComponent(id));
  }

  reserve(id: string, quantity: number): Promise<{ reservationId: string }> {
    return this.http.post('/reservations', { id, quantity });
  }
}
```

Các method `get`, `post`, `put`, `patch` và `delete` nhận cấu hình Axios request
tương ứng và trả về `response.data`.

## Giới hạn trường được truyền {#limit-propagated-fields}

```ts
http: {
  baseURL: 'https://inventory.internal.example',
  trustedOrigins: ['https://inventory.internal.example'],
  propagateHeaders: ['x-tenant', 'x-department-code'],
},
```

Đoạn mã này nằm trong `SdCoreModule.forRoot({...})`. Liệt kê `authorization` hoặc
`x-internal-secret` tại đây không có hiệu lực; cả hai chủ động bị loại trừ.

## Checklist miền tin cậy {#trust-domain-checklist}

- Chỉ đưa vào allowlist những service chấp nhận cùng ngữ nghĩa danh tính.
- Xác thực service riêng bằng mTLS, workload identity hoặc application credential.
- Không tin cậy header user được truyền ở public endpoint.
- Hạn chế đưa URL tuyệt đối bên ngoài vào method của internal client khi có thể.
- Kiểm thử redirect từ nơi đáng tin cậy đến nơi không đáng tin cậy và xác minh header danh tính/secret vắng mặt.
