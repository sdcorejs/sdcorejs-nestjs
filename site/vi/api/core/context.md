# API request context {#request-context-api}

Đường dẫn import: `@sdcorejs/nestjs/core`

`ContextModule` cài middleware dựa trên `AsyncLocalStorage` của Node.js. Nó thu thập metadata
transport cho mỗi HTTP request và cung cấp danh tính đã xác minh cho repository, guard và service
phía sau mà không request-scope dependency graph của Nest.

## Các export {#exports}

| Export | Loại | Mục đích |
| --- | --- | --- |
| `ContextModule`, `ContextModuleOptions` | class/type | Module context global và option `forRoot` |
| `ContextService` | class | Đọc/ghi store của request đang hoạt động |
| `ContextMiddleware` | class | Middleware Nest được `ContextModule` áp dụng cho mọi route |
| `RequestContext` | interface | Store chuẩn theo từng request |
| `HeadersConfig` | interface | Ánh xạ header tenant/user/ngôn ngữ và header tùy chỉnh |
| `ContextIdentityOptions` | interface | Principal resolver và chế độ trusted-header tùy chọn |
| `ResolvedContextIdentityOptions` | interface | Cấu hình DI đã phân giải đầy đủ |
| `ResolvedContextIdentity` | interface | Các trường danh tính đã validation |
| `IdentityContextSource` | type | `'trusted-headers' \| 'verified-principal'` |
| `TrustedHeaderIdentityOptions` | interface | Gateway verifier và header mapper tùy chọn |
| `VerifiedPrincipalResolver` | type | Ánh xạ `req.user` đã xác minh sang danh tính chuẩn |
| `defaultVerifiedPrincipalResolver` | function | Ánh xạ thận trọng các tên claim phổ biến |
| `normalizeContextIdentity` | function | Kiểm tra runtime/sao chép giá trị danh tính |
| `CONTEXT_HEADERS_CONFIG`, `CONTEXT_IDENTITY_CONFIG` | value | DI token |

## Cấu hình danh tính đã xác minh {#configure-verified-identity}

```ts
import { z } from 'zod';

const PrincipalSchema = z.object({
  sub: z.string().min(1),
  organization_id: z.string().min(1).max(64),
  realm_access: z.object({ roles: z.array(z.string().min(1)) }).optional(),
  permissions_version: z.string().min(1).optional(),
});

ContextModule.forRoot({
  headers: {
    lang: ['accept-language', 'x-language'],
    customHeaders: { correlationId: 'x-correlation-id' },
  },
  identity: {
    principalResolver: async (principal: unknown) => {
      const claims = PrincipalSchema.parse(principal);
      return {
        userId: claims.sub,
        tenant: claims.organization_id,
        roles: claims.realm_access?.roles ?? [],
        permissionVersion: claims.permissions_version,
      };
    },
  },
});
```

Header mặc định là `x-tenant`, `x-user-id`, cùng thứ tự ưu tiên ngôn ngữ `accept-language`,
`x-language`. Identity header **không được tin cậy theo mặc định**. Ngôn ngữ và header
`Authorization` thô là metadata transport; chúng không thiết lập người dùng đã xác thực.

Principal resolver mặc định chấp nhận claim `sub`, `userId` hoặc `id` là chuỗi không rỗng hoặc số
hữu hạn, và các giá trị tùy chọn `tenant`, `tenantId`, `permissionVersion`; số hữu hạn được chuẩn hóa
thành chuỗi. `roles` và `permissions` phải là mảng chuỗi; hình dạng khác sẽ fail.

## Chế độ trusted-header rõ ràng {#explicit-trusted-header-mode}

```ts
import { UnauthorizedException } from '@nestjs/common';

function requiredIdentityHeader(value: string | string[] | undefined, name: string): string {
  if (typeof value !== 'string') throw new UnauthorizedException(`Missing ${name}`);
  const normalized = value.trim();
  if (!normalized || normalized.length > 64 || !/^[A-Za-z0-9._:-]+$/.test(normalized)) {
    throw new UnauthorizedException(`Invalid ${name}`);
  }
  return normalized;
}

ContextModule.forRoot({
  identity: {
    trustedHeaders: {
      isTrustedRequest: (req) => req.socket.remoteAddress === '10.20.0.15',
      resolve: (req) => ({
        userId: requiredIdentityHeader(req.headers['x-user-id'], 'x-user-id'),
        tenant: requiredIdentityHeader(req.headers['x-tenant'], 'x-tenant'),
      }),
    },
  },
});
```

`isTrustedRequest` phải xác minh một boundary thật như mTLS, địa chỉ proxy đã xác minh phía sau cấu
hình proxy đúng, hoặc header đã ký. Nếu identity header tồn tại và verifier trả về bất kỳ giá trị
nào khác `true`, middleware sẽ ném lỗi 401. Sau đó, `AuthGuard` so sánh phần danh tính trusted-header
trùng lặp với principal Passport đã xác minh và từ chối xung đột.

## `RequestContext` {#requestcontext}

```ts
interface RequestContext {
  userId?: string;
  tenant?: string;
  roles?: string[];
  lang?: string;
  token?: string;
  user?: unknown;
  permissions?: string[];
  permissionVersion?: string;
  identitySource?: 'trusted-headers' | 'verified-principal';
  request?: IncomingMessage;
  response?: ServerResponse;
  custom?: Record<string, unknown>;
}
```

Dùng `custom` hoặc declaration merging cho trường riêng của domain. Không bao giờ đặt state global
có thể tái sử dụng vào request store.

## `ContextService` {#contextservice}

| Thành viên | Signature / kết quả |
| --- | --- |
| `run` | `run<R>(store, fn): R` bắt đầu một scope ALS |
| `store` | `RequestContext \| undefined` hiện tại |
| `get` / `set` | Truy cập key có kiểu vào store đang hoạt động; `set` là no-op bên ngoài scope |
| `setIdentity` | Thay thế nguyên tử các trường nhạy cảm về bảo mật và ghi nhận nguồn |
| `getCustom<T>` | Đọc `custom[key]` |
| `userId`, `tenant`, `lang`, `token`, `user`, `permissionVersion` | Getter tiện ích |
| `roles`, `permissions` | Getter tiện ích; trả `[]` khi vắng mặt |
| `hasPermission` | Kiểm tra membership chính xác trong permission đã phân giải |

```ts
@Injectable()
export class OrdersService {
  constructor(private readonly context: ContextService) {}

  currentBoundary() {
    return {
      tenant: this.context.tenant,
      actor: this.context.userId,
      correlationId: this.context.getCustom<string>('correlationId'),
    };
  }
}
```

## Lưu ý bảo mật {#security-notes}

- Coi `token`, `request`, `response` và `user` là tham chiếu runtime nhạy cảm; không log hoặc
  serialize toàn bộ context.
- Không gọi `setIdentity` từ request handler tùy ý. `AuthGuard` chỉ dùng nó sau khi xác minh JWT và
  kiểm tra xung đột.
- Công việc async tách khỏi request có thể sống lâu hơn context. Truyền giá trị rõ ràng tới queue
  hoặc job thay vì giả định ALS vẫn khả dụng sau đó.
