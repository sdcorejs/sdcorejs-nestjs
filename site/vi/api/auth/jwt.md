# API JWT và JWKS {#jwt-and-jwks-api}

Đường dẫn import: `@sdcorejs/nestjs/auth`

`JwtModule` đăng ký một Passport strategy tên `jwt`. Chọn xác minh bằng symmetric-secret hoặc
JWKS/OIDC; việc bảo vệ route được áp dụng riêng bằng `AuthGuard` hoặc Passport guard của Nest.

## Các export {#exports}

| Export | Loại | Mục đích |
| --- | --- | --- |
| `JwtConfig` | interface | Cấu hình xác minh JWT dùng chung |
| `JwksConfig` | interface | Policy issuer/JWKS và option client |
| `JwtPayload` | interface | Payload tối thiểu với `sub` bắt buộc và `iss` tùy chọn |
| `JWT_CONFIG` | value | DI token cho `JwtConfig` |
| `JwtStrategy` | class | Strategy `passport-jwt` đối xứng |
| `KeycloakJwtStrategy` | class | Strategy JWKS theo từng issuer cho Keycloak/OIDC |
| `JwtModule`, `JwtModuleOptions` | class/type | Module đăng ký strategy global |

## Chế độ đối xứng {#symmetric-mode}

```ts
JwtModule.forRoot({
  secret: process.env.JWT_SECRET,
  issuer: 'https://auth.internal.example',
  audience: 'orders-api',
  cookieName: 'access_token',
});
```

`secret` là bắt buộc đối với `JwtStrategy`; thiếu cấu hình sẽ ném lỗi khi khởi tạo. Token được đọc từ
`Authorization: Bearer ...` trước, sau đó từ `cookieName` nếu đã cấu hình. Thời hạn, issuer tùy chọn
và audience tùy chọn được `passport-jwt` xác minh.

`expiresIn` tồn tại trên `JwtConfig` cho cấu hình ứng dụng dùng chung nhưng không được strategy xác
minh nào sử dụng; việc ký/phát hành vẫn thuộc trách nhiệm của ứng dụng.

## Chế độ JWKS/OIDC {#jwks-oidc-mode}

```ts
JwtModule.forRoot({
  audience: 'orders-api',
  jwks: {
    allowedIssuerHosts: ['https://keycloak.example.com'],
    algorithms: ['RS256'],
    cache: true,
    rateLimit: true,
  },
});
```

Khi có `config.jwks`, `JwtModule` chọn `KeycloakJwtStrategy`. Nó trích xuất bearer token, giải mã
`iss` và `kid`, kiểm tra issuer policy, dựng URL JWKS, lấy public key tương ứng, rồi để
`passport-jwt` xác minh chữ ký và claim. Runtime cần `jwks-rsa` và `jsonwebtoken`.

Bắt buộc phải có ít nhất một issuer policy:

| Option | Cách khớp |
| --- | --- |
| `allowedIssuers` | Chính xác toàn bộ URL issuer |
| `allowedIssuerHosts` | Chính xác origin HTTP(S) đã chuẩn hóa; mọi realm/path trên origin tin cậy đó |
| `issuerValidator` | Predicate của ứng dụng; dùng cho tra cứu realm đã cấp phát hoặc quy tắc có giới hạn khác |

Nếu không có policy, quá trình khởi tạo thất bại. Điều này ngăn JWKS SSRF do token kiểm soát. URL
JWKS mặc định là `${iss}/protocol/openid-connect/certs`; chỉ override `jwksUriFromIssuer` nếu nó vẫn
ánh xạ một issuer đã được cấp quyền tới endpoint tin cậy. Algorithm mặc định là `['RS256']`; cache
JWKS và giới hạn tốc độ mặc định là `true`. Cache client theo issuer được giới hạn 100 entry.

Cả strategy symmetric-secret và JWKS đều kiểm tra bearer token trước, rồi fallback về
`cookieName` đã cấu hình. HTTP adapter hoặc middleware của bạn phải điền `request.cookies` để xác
thực bằng cookie hoạt động.

## Validation/enrichment tùy chỉnh {#custom-validation-enrichment}

Cả hai strategy tích hợp đều trả nguyên payload đã xác minh. Hãy kế thừa một strategy để phân giải
principal ứng dụng có giới hạn:

```ts
@Injectable()
export class AppJwtStrategy extends KeycloakJwtStrategy {
  constructor(
    @Inject(JWT_CONFIG) config: JwtConfig,
    private readonly users: UsersService,
  ) {
    super(config);
  }

  override async validate(payload: JwtPayload) {
    const user = await this.users.findBySubject(payload.sub);
    if (!user) throw new UnauthorizedException();
    return {
      sub: payload.sub,
      tenant: user.tenantCode,
      roles: user.roles,
      permissionVersion: user.permissionVersion,
    };
  }
}

JwtModule.forRoot(
  {
    audience: 'orders-api',
    jwks: { allowedIssuers: ['https://keycloak.example.com/realms/orders'] },
  },
  { strategy: AppJwtStrategy, imports: [UsersModule] },
);
```

`JwtModuleOptions.strategy` thay thế lớp mặc định. `imports` cung cấp các dependency của lớp đó
trong dynamic module.

## Kết nối JWT với danh tính request {#connect-jwt-to-request-identity}

Xác minh Passport tạo `req.user`; sau đó `AuthGuard` ánh xạ nó qua
`context.identity.principalResolver` và cài đặt nguyên tử danh tính đã xác minh vào
`ContextService`. Mapper mặc định chấp nhận các tên claim phổ biến, nhưng ứng dụng production nên
ánh xạ chính xác claim của mình:

```ts
import { z } from 'zod';

const PrincipalSchema = z.object({
  sub: z.string().min(1),
  tenant: z.string().min(1).max(64),
  roles: z.array(z.string().min(1)).optional(),
});

SdCoreModule.forRoot({
  context: {
    identity: {
      principalResolver: (principal: unknown) => {
        const claims = PrincipalSchema.parse(principal);
        return {
          userId: claims.sub,
          tenant: claims.tenant,
          roles: claims.roles,
        };
      },
    },
  },
  jwt: {
    audience: 'orders-api',
    jwks: { allowedIssuerHosts: ['https://keycloak.example.com'] },
  },
});
```

## Checklist bảo mật {#security-checklist}

- Không bao giờ commit symmetric secret. Đọc chúng từ secret manager hoặc môi trường.
- Pin `audience` và, khi có thể, issuer chính xác. `allowedIssuerHosts` chủ ý tin cậy mọi path/realm
  trên một origin và chỉ phù hợp khi toàn bộ host đó được kiểm soát.
- Không dùng `jwt.decode` để xác minh; việc giải mã trong `KeycloakJwtStrategy` chỉ để định vị khóa
  đã được policy phê duyệt trước khi Passport xác minh chữ ký.
- Đặt algorithm rõ ràng nếu identity provider dùng tập hẹp hơn mặc định RS256.
- Áp dụng [`AuthGuard`](./permissions.md) cho route; chỉ import `JwtModule` không bảo vệ route.
