# Danh tính và permission {#identity-and-permissions}

Ví dụ này xác minh token Keycloak, ánh xạ claim đáng tin cậy vào request context và suy ra mã
permission từ role đã xác minh.

## Policy principal và permission {#principal-and-permission-policy}

```ts
import { Injectable } from '@nestjs/common';
import type { IPermissionStrategy } from '@sdcorejs/nestjs/auth';
import type { RequestContext } from '@sdcorejs/nestjs/core';
import { z } from 'zod';

export const KeycloakClaimsSchema = z.object({
  sub: z.string().min(1),
  tenant_code: z.string().min(1).max(64),
  permission_version: z.string().min(1).optional(),
  realm_access: z.object({ roles: z.array(z.string().min(1)).optional() }).optional(),
});

@Injectable()
export class RolePermissionStrategy implements IPermissionStrategy {
  async load(context: RequestContext): Promise<string[]> {
    const roles = context.roles ?? [];
    const permissions = new Set<string>();
    if (roles.includes('product-reader')) permissions.add('product:read');
    if (roles.includes('product-editor')) permissions.add('product:write');
    if (roles.includes('platform-admin')) permissions.add('product:*');
    return [...permissions];
  }

  check(codes: string[], required: string): boolean {
    return codes.some(
      (code) =>
        code === required ||
        (code.endsWith(':*') && required.startsWith(code.slice(0, -1))),
    );
  }
}
```

Trong ứng dụng thực, `load()` có thể query một permission service bằng `userId` và tenant. Method
này được gọi một lần trên mỗi request khi route khai báo metadata permission.

## Cấu hình root {#root-configuration}

```ts
import { SdCoreModule } from '@sdcorejs/nestjs';

const issuer = process.env.KEYCLOAK_ISSUER;
if (!issuer) throw new Error('KEYCLOAK_ISSUER is required');

SdCoreModule.forRoot({
  context: {
    identity: {
      principalResolver: (principal: unknown) => {
        const claims = KeycloakClaimsSchema.parse(principal);
        return {
          userId: claims.sub,
          tenant: claims.tenant_code,
          roles: claims.realm_access?.roles ?? [],
        };
      },
    },
  },
  jwt: {
    jwks: {
      allowedIssuers: [issuer],
      algorithms: ['RS256'],
    },
    issuer,
    audience: 'products-api',
  },
  permission: { strategy: RolePermissionStrategy },
  tenancy: {
    resolve: (context) => ({ tenantCode: context.tenant }),
  },
});
```

Các symbol `KeycloakClaimsSchema` và `RolePermissionStrategy` là declaration của ứng dụng từ snippet
đầu tiên. Realm tĩnh nên dùng `allowedIssuers`; realm động có thể dùng `allowedIssuerHosts` để pin
chính xác origin Keycloak.

## Route {#routes}

```ts
import { Controller, Get, Patch, UseGuards } from '@nestjs/common';
import {
  AuthGuard,
  HasAnyPermission,
  HasPermission,
} from '@sdcorejs/nestjs/auth';

@Controller('products')
@UseGuards(AuthGuard)
class ProductAuthorizationController {
  @Get()
  @HasPermission('product:read')
  list() {
    return [];
  }

  @Patch('bulk')
  @HasAnyPermission('product:write', 'product:admin')
  bulkUpdate() {
    return { accepted: true };
  }
}
```

Kết quả mong đợi:

- không có/bearer token không hợp lệ/hết hạn → 401;
- token đã xác minh nhưng principal không ánh xạ được thành user và tenant → 401;
- danh tính đã xác minh không có permission khớp → 403;
- permission chính xác hoặc wildcard khớp → controller thực thi.

## Cache nhạy cảm với permission {#permission-sensitive-caching}

Khi permission có thể thay đổi trong thời gian sống của token, hãy ánh xạ một version/fingerprint:

```ts
return {
  userId: claims.sub,
  tenant: claims.tenant_code,
  roles: claims.realm_access?.roles ?? [],
  permissionVersion: String(claims.permission_version ?? '0'),
};
```

`permission_version` là signed claim do ứng dụng định nghĩa trong fragment này. Namespace cache
tenant/user bao gồm `permissionVersion`, role và permission đã phân giải.

## Phương án trusted gateway {#trusted-gateway-alternative}

Nếu gateway thay vì JWT thiết lập danh tính, hãy cấu hình
`context.identity.trustedHeaders.isTrustedRequest` bằng phép kiểm tra mTLS/chữ ký/ranh giới proxy
thật. Không gửi `X-User-Id` giả trong test rồi xem tính năng đã hoàn tất: hãy thêm negative test chứng
minh cùng các header đó nhưng không có bằng chứng gateway sẽ trả về 401.
