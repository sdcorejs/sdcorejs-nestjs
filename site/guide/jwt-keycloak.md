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
      // Static, known realms — exact match:
      allowedIssuers: [process.env.KEYCLOAK_ISSUER!],
      // jwksUriFromIssuer defaults to `${iss}/protocol/openid-connect/certs` (Keycloak)
    },
  },
});
```

::: warning An issuer policy is REQUIRED
You must declare which issuers to trust — set at least one of `allowedIssuers`, `allowedIssuerHosts`,
or `issuerValidator`. The strategy **throws at construction** otherwise. Without a policy the signing
key would be fetched from any token-supplied `iss` URL (issuer spoofing + SSRF).
:::

### Dynamic multi-realm (realms created at runtime)

A single `iss` is **not** enough — every realm is a distinct issuer (`…/realms/<realm>`). Don't try to
list them all. Instead pin the Keycloak **origin** with `allowedIssuerHosts`: any realm under a trusted
host is accepted, and the JWKS is only ever fetched from that host (so SSRF stays closed) even as new
tenants/realms are provisioned.

```ts
jwks: {
  // Accepts https://kc.example.com/realms/<any-tenant> — no per-realm config:
  allowedIssuerHosts: ['https://kc.example.com'],
}
```

For anything more bespoke (regex, a DB lookup of provisioned realms), use the predicate:

```ts
jwks: { issuerValidator: (iss) => /^https:\/\/kc\.example\.com\/realms\/[a-z0-9-]+$/.test(iss) }
```

The three options compose — an `iss` is accepted if it matches `allowedIssuers`, OR its origin is in
`allowedIssuerHosts`, OR `issuerValidator(iss)` returns `true`.

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
