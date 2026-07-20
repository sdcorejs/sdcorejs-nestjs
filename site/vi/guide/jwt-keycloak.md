# JWT và Keycloak {#jwt-and-keycloak}

`AuthGuard` mở rộng guard `jwt` của Passport. Hãy bật xác minh đối xứng hoặc xác minh JWKS/OIDC;
không cấu hình cả hai.

## Keycloak hoặc OIDC với JWKS {#keycloak-or-oidc-with-jwks}

```ts
import { SdCoreModule } from '@sdcorejs/nestjs';

const issuer = process.env.KEYCLOAK_ISSUER;
if (!issuer) throw new Error('KEYCLOAK_ISSUER is required');

SdCoreModule.forRoot({
  jwt: {
    jwks: {
      allowedIssuers: [issuer],
      algorithms: ['RS256'],
    },
    issuer,
    audience: 'orders-api',
  },
});
```

URL JWKS mặc định nối thêm `/protocol/openid-connect/certs` vào token issuer. Cần có ít nhất một
issuer policy:

- `allowedIssuers` cho các URL issuer chính xác, đã biết;
- `allowedIssuerHosts` cho realm động dưới một origin đáng tin cậy chính xác; hoặc
- `issuerValidator` cho quy tắc do ứng dụng sở hữu.

Nếu không có policy, quá trình khởi tạo thất bại. Điều này ngăn issuer do token kiểm soát biến việc tra cứu JWKS
thành SSRF. `allowedIssuerHosts: ['https://id.example.com']` so sánh origin chính xác; nó không
tin tưởng host giả mạo hoặc origin ngang hàng.

Strategy mặc định dùng RS256, key được cache/giới hạn tốc độ và cache tối đa 100 issuer client.

## JWT đối xứng {#symmetric-jwt}

```ts
import { SdCoreModule } from '@sdcorejs/nestjs';

const secret = process.env.JWT_SECRET;
if (!secret) throw new Error('JWT_SECRET is required');

SdCoreModule.forRoot({
  jwt: {
    secret,
    issuer: 'orders-api',
    audience: 'orders-web',
    cookieName: 'access_token',
  },
});
```

Trích xuất Bearer luôn chạy trước. `cookieName` thêm một fallback và yêu cầu cookie parser middleware
của ứng dụng. Strategy đối xứng từ chối cấu hình không có secret.

## Ánh xạ principal đã xác minh {#map-the-verified-principal}

Các strategy cơ sở trả về payload đã xác minh dưới dạng `req.user`. Cấu hình
`context.identity.principalResolver` để ánh xạ payload:

```ts
import { SdCoreModule } from '@sdcorejs/nestjs';
import { z } from 'zod';

const KeycloakClaimsSchema = z.object({
  sub: z.string().min(1),
  tenant_code: z.string().min(1).max(64),
  realm_access: z.object({ roles: z.array(z.string().min(1)).optional() }).optional(),
});

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
    jwks: { allowedIssuers: [issuer] },
  },
});
```

Đoạn mã tập trung này tái sử dụng hằng `issuer` đã validate từ ví dụ đầu tiên.

## Strategy tùy chỉnh với service được inject {#custom-strategy-with-injected-services}

Khi việc xác minh phải truy vấn service của ứng dụng, hãy kế thừa strategy và import trực tiếp `JwtModule`.
Service ví dụ dưới đây cố ý tối giản nhưng đầy đủ; hãy thay phần tra cứu bằng lời gọi cơ sở dữ liệu của bạn.

```ts
import {
  Inject,
  Injectable,
  Module,
  UnauthorizedException,
} from '@nestjs/common';
import { SdCoreModule } from '@sdcorejs/nestjs';
import {
  JWT_CONFIG,
  JwtModule,
  KeycloakJwtStrategy,
  type JwtConfig,
  type JwtPayload,
} from '@sdcorejs/nestjs/auth';
import { z } from 'zod';

const AppUserSchema = z.object({ id: z.string().min(1) });

@Injectable()
class UsersService {
  async findBySubject(subject: string): Promise<{ id: string } | undefined> {
    return subject ? { id: subject } : undefined;
  }
}

@Module({ providers: [UsersService], exports: [UsersService] })
class UsersModule {}

@Injectable()
class AppJwtStrategy extends KeycloakJwtStrategy {
  constructor(
    @Inject(JWT_CONFIG) config: JwtConfig,
    private readonly users: UsersService,
  ) {
    super(config);
  }

  async validate(payload: JwtPayload) {
    const user = await this.users.findBySubject(payload.sub);
    if (!user) throw new UnauthorizedException();
    return user;
  }
}

const appIssuer = process.env.KEYCLOAK_ISSUER;
if (!appIssuer) throw new Error('KEYCLOAK_ISSUER is required');

const jwtConfig: JwtConfig = {
  jwks: { allowedIssuers: [appIssuer] },
};

@Module({
  imports: [
    SdCoreModule.forRoot({
      context: {
        identity: {
          principalResolver: (principal: unknown) => ({
            userId: AppUserSchema.parse(principal).id,
          }),
        },
      },
    }),
    JwtModule.forRoot(jwtConfig, {
      strategy: AppJwtStrategy,
      imports: [UsersModule],
    }),
  ],
})
export class AppModule {}
```

Bỏ khóa `jwt` khỏi `SdCoreModule.forRoot()` trong mẫu này vì `JwtModule` được cấu hình
riêng.

## Checklist production {#production-checklist}

- Dùng HTTPS và validate `issuer` cùng `audience` khi có thể.
- Giới hạn hẹp các thuật toán được chấp nhận.
- Ưu tiên URL issuer chính xác khi realm là tĩnh.
- Không bao giờ decode token rồi xem kết quả là danh tính đã xác minh.
- Bảo đảm principal resolver trả về tenant từ claim đáng tin cậy hoặc tra cứu cơ sở dữ liệu.
- Giữ JWT trong cookie ở chế độ `HttpOnly`, `Secure` và bảo vệ chống CSRF theo client flow của bạn.
