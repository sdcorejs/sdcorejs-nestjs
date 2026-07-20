# API xác thực và phân quyền {#authentication-and-authorization-api}

Đường dẫn import: `@sdcorejs/nestjs/auth`

Entrypoint auth có hai lớp:

- [JWT và JWKS](./jwt.md) đăng ký strategy Passport `jwt` và xác minh token đối xứng hoặc token bất
  đối xứng có scope theo issuer.
- [Permission và lời gọi nội bộ](./permissions.md) ánh xạ principal đã xác minh vào request context,
  kiểm tra permission của route và bảo vệ route service-to-service.

```ts
import {
  AuthGuard,
  HasPermission,
  KeycloakJwtStrategy,
} from '@sdcorejs/nestjs/auth';
```

Import `JwtModule` không bảo vệ route. Hãy áp dụng `AuthGuard` cục bộ hoặc global; decorator
permission gắn metadata nhưng không tự cài guard. Danh tính trusted-header là một chế độ gateway
riêng biệt, được xác minh rõ ràng và mô tả trong [request context](../core/context.md).

## Chọn chế độ xác minh {#choose-a-verification-mode}

| Chế độ | Cấu hình bắt buộc | Mục đích sử dụng khuyến nghị |
| --- | --- | --- |
| Đối xứng | `secret` | Hệ thống được kiểm soát và chủ ý dùng chung một signing secret |
| JWKS/OIDC | `jwks` cùng issuer policy | Keycloak/OIDC và khóa bất đối xứng xoay vòng |

Chế độ JWKS yêu cầu ít nhất một trong `allowedIssuers`, `allowedIssuerHosts` hoặc
`issuerValidator` để token không thể hướng server tới endpoint khóa do kẻ tấn công kiểm soát.
