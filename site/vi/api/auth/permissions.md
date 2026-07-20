# API permission và lời gọi nội bộ {#permissions-and-internal-call-api}

Đường dẫn import: `@sdcorejs/nestjs/auth`

Entrypoint này cung cấp hai guard độc lập: `AuthGuard` xác thực JWT và kiểm tra permission của route;
`InternalGuard` xác thực lời gọi service-to-service bằng provider shared-secret có thể xoay vòng.

## Các export permission {#permission-exports}

| Export | Loại | Mục đích |
| --- | --- | --- |
| `IPermissionStrategy` | interface | Tải và tùy chọn diễn giải các mã permission |
| `DefaultPermissionStrategy` | class | Mặc định deny-all |
| `PERMISSION_STRATEGY` | value | DI token của strategy |
| `PERMISSION_METADATA_KEY` | value | Khóa metadata của decorator |
| `HasPermission` | decorator | Yêu cầu một mã |
| `HasAnyPermission` | decorator | Yêu cầu bất kỳ mã nào được cung cấp (OR) |
| `AuthGuard` | class | Guard Passport `jwt` cùng kiểm tra danh tính đã xác minh và permission |
| `PermissionModule`, `PermissionModuleOptions` | class/type | Đăng ký strategy và guard ở phạm vi global |

```ts
@Injectable()
export class AppPermissionStrategy implements IPermissionStrategy {
  async load(ctx: RequestContext): Promise<string[]> {
    if (!ctx.userId || !ctx.tenant) return [];
    return permissionsFor(ctx.tenant, ctx.userId);
  }

  check(codes: string[], required: string): boolean {
    const [resource] = required.split(':');
    return codes.includes(required) || codes.includes(`${resource}:*`);
  }
}

PermissionModule.forRoot({ strategy: AppPermissionStrategy });
```

```ts
@UseGuards(AuthGuard)
@HasAnyPermission('product:read', 'product:admin')
@Get(':id')
detail() {}
```

`AuthGuard` luôn chạy xác thực Passport, kể cả khi route không có metadata permission. Nó ánh xạ
`req.user` đã xác minh vào `ContextService`, từ chối xung đột với danh tính trusted-gateway hiện có,
rồi đánh giá permission. Các mã bắt buộc dùng ngữ nghĩa OR. Permission được tải tối đa một lần cho
mỗi request và được phản chiếu vào context. Mảng `permissions` rõ ràng của principal đã xác minh có
thể thỏa cache mà không gọi `load`.

`check` mặc định là `Array.includes` chính xác. Thiếu permission sẽ ném lỗi 403 với code
`core.permission.forbidden`; principal đã xác minh bị thiếu hoặc không hợp lệ sẽ ném lỗi 401 không
tiết lộ thông tin định danh.

## Các export cho lời gọi nội bộ {#internal-call-exports}

| Export | Loại | Mục đích |
| --- | --- | --- |
| `IInternalSecretProvider` | interface | Khóa hiện tại và tập khóa xoay vòng tùy chọn |
| `INTERNAL_SECRET_PROVIDER` | value | DI token của secret-provider |
| `EnvInternalSecretProvider` | class | Đọc biến môi trường; mặc định `INTERNAL_SECRET_KEY` |
| `IInternalContextEnricher` | interface | Hook context tin cậy được gọi sau khi xác minh secret |
| `INTERNAL_CONTEXT_ENRICHER` | value | DI token của enricher |
| `InternalGuard` | class | Guard shared-secret so sánh constant-time |
| `INTERNAL_SECRET_HEADER` | value | Header mặc định: `x-internal-secret` |

### Cấu hình provider xoay vòng {#configure-a-rotating-provider}

```ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';

function requiredIdentityHeader(value: string | string[] | undefined, name: string): string {
  if (typeof value !== 'string') throw new UnauthorizedException(`Missing ${name}`);
  const normalized = value.trim();
  if (!normalized || normalized.length > 64 || !/^[A-Za-z0-9._:-]+$/.test(normalized)) {
    throw new UnauthorizedException(`Invalid ${name}`);
  }
  return normalized;
}

@Injectable()
export class RotatingInternalSecrets implements IInternalSecretProvider {
  async getKey(): Promise<string> {
    return secretStore.current();
  }

  async getKeys(): Promise<string[]> {
    return secretStore.currentAndPrevious();
  }
}

@Injectable()
export class InternalIdentity implements IInternalContextEnricher {
  constructor(private readonly context: ContextService) {}

  enrich(req: IncomingMessage): void {
    const tenant = requiredIdentityHeader(req.headers['x-tenant'], 'x-tenant');
    const caller = requiredIdentityHeader(req.headers['x-caller'], 'x-caller');
    this.context.set('tenant', tenant);
    this.context.set('custom', { caller });
  }
}

SdCoreModule.forRoot({
  providers: [
    { provide: INTERNAL_SECRET_PROVIDER, useClass: RotatingInternalSecrets },
    { provide: INTERNAL_CONTEXT_ENRICHER, useClass: InternalIdentity },
  ],
});
```

Nếu có `getKeys`, `InternalGuard` chấp nhận bất kỳ khóa nào được trả về và không gọi `getKey`. Nó
dùng `timingSafeEqual`; độ dài khác nhau sẽ fail trước khi so sánh. Enricher chỉ chạy sau khi có
secret hợp lệ.

```ts
@UseGuards(InternalGuard)
@Post('reindex')
reindex() {}
```

### Lỗi {#errors}

| Điều kiện | Trạng thái | Code |
| --- | --- | --- |
| Provider chưa đăng ký | 500 | `core.permission.internal-secret-provider-missing` |
| Thiếu header | 403 | `core.permission.internal-secret-missing` |
| Không khóa nào khớp | 403 | `core.permission.internal-secret-mismatch` |

## Lưu ý bảo mật {#security-notes}

- Nên dùng `getKeys()` trong thời gian xoay vòng, sau đó xóa khóa cũ khi các caller đã chuyển đổi.
- `EnvInternalSecretProvider` không trả khóa hợp lệ khi biến môi trường vắng mặt, vì vậy route vẫn
  đóng. Coi lỗi 500 là cấu hình vận hành sai.
- Chỉ gửi internal secret tới origin tin cậy chính xác. [`HttpService`](../services/http.md) loại bỏ
  secret khỏi request và redirect không tin cậy nhưng không bao giờ tự tạo secret header cho bạn.
- Không suy ra tenant/user context tin cậy trước khi kiểm tra secret; đặt công việc đó trong
  `IInternalContextEnricher`.
- Decorator permission của route là metadata, không phải đăng ký guard. Luôn áp dụng `AuthGuard`
  cục bộ hoặc global.
