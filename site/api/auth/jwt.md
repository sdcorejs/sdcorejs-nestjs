# JWT and JWKS API

Import path: `@sdcorejs/nestjs/auth`

`JwtModule` registers one Passport strategy named `jwt`. Choose symmetric-secret verification or
JWKS/OIDC verification; route protection is applied separately with `AuthGuard` or Nest's Passport
guard.

## Exports

| Export | Kind | Purpose |
| --- | --- | --- |
| `JwtConfig` | interface | Shared JWT verification configuration |
| `JwksConfig` | interface | Issuer/JWKS policy and client options |
| `JwtPayload` | interface | Minimal payload with required `sub` and optional `iss` |
| `JWT_CONFIG` | value | DI token for `JwtConfig` |
| `JwtStrategy` | class | Symmetric `passport-jwt` strategy |
| `KeycloakJwtStrategy` | class | Per-issuer JWKS strategy for Keycloak/OIDC |
| `JwtModule`, `JwtModuleOptions` | class/type | Global strategy registration module |

## Symmetric mode

```ts
JwtModule.forRoot({
  secret: process.env.JWT_SECRET,
  issuer: 'https://auth.internal.example',
  audience: 'orders-api',
  cookieName: 'access_token',
});
```

`secret` is required by `JwtStrategy`; missing configuration throws during construction. Tokens are
read from `Authorization: Bearer ...` first and then from `cookieName` when configured. Expiration,
optional issuer and optional audience are verified by `passport-jwt`.

`expiresIn` exists on `JwtConfig` for shared application configuration but is not consumed by either
verification strategy; signing/issuance remains the application's responsibility.

## JWKS/OIDC mode

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

When `config.jwks` exists, `JwtModule` selects `KeycloakJwtStrategy`. It extracts bearer tokens,
decodes `iss` and `kid`, checks the issuer policy, builds the JWKS URL, fetches the matching public
key, and then lets `passport-jwt` verify signature and claims. Runtime use requires `jwks-rsa` and
`jsonwebtoken`.

At least one issuer policy is mandatory:

| Option | Match |
| --- | --- |
| `allowedIssuers` | Exact full issuer URL |
| `allowedIssuerHosts` | Exact normalized HTTP(S) origin; any realm/path on that trusted origin |
| `issuerValidator` | Application predicate; use for provisioned realm lookups or other bounded rules |

Without a policy, construction fails. This prevents token-controlled JWKS SSRF. The default JWKS
URL is `${iss}/protocol/openid-connect/certs`; override `jwksUriFromIssuer` only if it still maps an
already-authorized issuer to a trusted endpoint. Default algorithms are `['RS256']`; JWKS cache and
rate limiting default to `true`. The per-issuer client cache is bounded to 100 entries.

Both symmetric-secret and JWKS strategies check the bearer token first, then fall back to the configured `cookieName`. Your HTTP adapter or middleware must populate `request.cookies` for cookie authentication to work.

## Custom validation/enrichment

Both built-in strategies return the verified payload unchanged. Subclass one to resolve a bounded
application principal:

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

`JwtModuleOptions.strategy` replaces the default class. `imports` makes dependencies of that class
available in the dynamic module.

## Connect JWT to request identity

Passport verification creates `req.user`; `AuthGuard` then maps it through
`context.identity.principalResolver` and atomically installs the verified identity in
`ContextService`. The default mapper accepts common claim names, but production applications should
map their exact claims:

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

## Security checklist

- Never commit symmetric secrets. Read them from a secret manager or environment.
- Pin `audience` and, when possible, exact issuers. `allowedIssuerHosts` intentionally trusts every
  path/realm on an origin and is appropriate only when that entire host is controlled.
- Do not use `jwt.decode` as verification; decoding in `KeycloakJwtStrategy` is only for locating a
  policy-approved key before Passport verifies the signature.
- Keep algorithms explicit if your identity provider uses a set narrower than the RS256 default.
- Apply [`AuthGuard`](./permissions.md) to routes; importing `JwtModule` alone does not protect them.
