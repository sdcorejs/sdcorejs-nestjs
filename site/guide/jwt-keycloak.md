# JWT and Keycloak

`AuthGuard` extends Passport's `jwt` guard. Enable either symmetric verification or JWKS/OIDC
verification; do not configure both.

## Keycloak or OIDC with JWKS

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

The default JWKS URL appends `/protocol/openid-connect/certs` to the token issuer. At least one
issuer policy is mandatory:

- `allowedIssuers` for exact, known issuer URLs;
- `allowedIssuerHosts` for dynamic realms under an exact trusted origin; or
- `issuerValidator` for an application-owned rule.

Without a policy, construction fails. This prevents a token-controlled issuer from turning JWKS
lookup into SSRF. `allowedIssuerHosts: ['https://id.example.com']` compares origins exactly; it does
not trust lookalike hosts or sibling origins.

The strategy defaults to RS256, cached/rate-limited keys, and a bounded cache of 100 issuer clients.

## Symmetric JWT

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

Bearer extraction always runs first. `cookieName` adds a fallback and requires the application's
cookie parser middleware. The symmetric strategy rejects configuration without a secret.

## Map the verified principal

The base strategies return the verified payload as `req.user`. Configure
`context.identity.principalResolver` to map it:

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

The focused snippet reuses the validated `issuer` constant from the first example.

## Custom strategy with injected services

When verification must query an application service, subclass the strategy and import `JwtModule`
directly. The example service below is intentionally minimal but complete; replace its lookup with
your database call.

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

Omit the `jwt` key from `SdCoreModule.forRoot()` in this pattern because `JwtModule` is configured
separately.

## Production checklist

- Use HTTPS and validate `issuer` and `audience` where possible.
- Keep accepted algorithms narrow.
- Prefer exact issuer URLs when realms are static.
- Never decode a token and treat the result as verified identity.
- Ensure the principal resolver returns the tenant from a trusted claim or database lookup.
- Keep cookie JWTs `HttpOnly`, `Secure`, and protected against CSRF according to your client flow.
