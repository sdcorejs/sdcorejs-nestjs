# JWT / Keycloak authentication

`AuthGuard` extends `PassportAuthGuard('jwt')`, so you register a passport-jwt strategy via `JwtModule`
(wired automatically by `SdCoreModule` when the `jwt` key is set).

## Keycloak / OIDC (asymmetric, JWKS)

Set `jwt.jwks` and `SdCoreModule` wires `KeycloakJwtStrategy`. The signing key is fetched per-token from
the issuer's JWKS endpoint, so multiple realms / tenants (different `iss`) work with no shared secret.
Requires `jwks-rsa` + `jsonwebtoken`.

```ts
SdCoreModule.forRoot({
  jwt: {
    jwks: {
      allowedIssuers: [process.env.KEYCLOAK_ISSUER!], // reject unknown issuers before any network call
      // jwksUriFromIssuer defaults to `${iss}/protocol/openid-connect/certs` (Keycloak)
    },
  },
});
```

To turn the verified token into your app's user, subclass and override `validate()`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { KeycloakJwtStrategy, JWT_CONFIG, type JwtConfig, type JwtPayload } from '@sdcorejs/nestjs/auth';

@Injectable()
export class AppJwtStrategy extends KeycloakJwtStrategy {
  constructor(@Inject(JWT_CONFIG) cfg: JwtConfig, private readonly users: UserService) {
    super(cfg);
  }
  async validate(payload: JwtPayload) {
    return {
      id: payload.sub,
      email: payload.email,
      roles: (payload.realm_access as { roles?: string[] })?.roles ?? [],
    };
  }
}

// pass it through JwtModule options when you need constructor deps:
//   JwtModule.forRoot(config, { strategy: AppJwtStrategy, imports: [UserModule] })
```

The object returned from `validate()` becomes `req.user` and is mirrored into `ContextService.user` by
`AuthGuard`.

## Symmetric secret (HS\*)

Omit `jwks` and pass a `secret` — `SdCoreModule` wires the symmetric `JwtStrategy`:

```ts
SdCoreModule.forRoot({ jwt: { secret: process.env.JWT_SECRET! } });
```
