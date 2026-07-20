# Authentication and authorization API

Import path: `@sdcorejs/nestjs/auth`

The auth entrypoint has two layers:

- [JWT and JWKS](./jwt.md) registers the Passport `jwt` strategy and verifies symmetric or
  issuer-scoped asymmetric tokens.
- [Permissions and internal calls](./permissions.md) maps the verified principal into request
  context, checks route permissions, and protects service-to-service routes.

```ts
import {
  AuthGuard,
  HasPermission,
  KeycloakJwtStrategy,
} from '@sdcorejs/nestjs/auth';
```

Importing `JwtModule` does not protect routes. Apply `AuthGuard` locally or globally; permission
decorators attach metadata but do not install the guard themselves. Trusted-header identity is a
separate, explicitly verified gateway mode documented in [request context](../core/context.md).

## Choose a verification mode

| Mode | Required configuration | Recommended use |
| --- | --- | --- |
| Symmetric | `secret` | Controlled systems that intentionally share one signing secret |
| JWKS/OIDC | `jwks` plus issuer policy | Keycloak/OIDC and rotating asymmetric keys |

JWKS mode requires at least one of `allowedIssuers`, `allowedIssuerHosts`, or `issuerValidator` so
the token cannot direct the server to an attacker-controlled key endpoint.
