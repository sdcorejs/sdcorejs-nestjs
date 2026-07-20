# Identity and permissions

This example verifies a Keycloak token, maps trusted claims into request context, and derives
permission codes from verified roles.

## Principal and permission policy

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

In a real application, `load()` can query a permission service using `userId` and tenant. It is
called once per request when a route declares permission metadata.

## Root configuration

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

The `KeycloakClaimsSchema` and `RolePermissionStrategy` symbols are the application declarations from
the first snippet. Static realms should use `allowedIssuers`; dynamic realms can use
`allowedIssuerHosts` to pin the exact Keycloak origin.

## Routes

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

Expected outcomes:

- no/invalid/expired bearer token → 401;
- verified token whose principal cannot map to a user and tenant → 401;
- verified identity without a matching permission → 403;
- matching exact or wildcard permission → controller executes.

## Permission-sensitive caching

When permission changes can happen during a token's lifetime, map a version/fingerprint:

```ts
return {
  userId: claims.sub,
  tenant: claims.tenant_code,
  roles: claims.realm_access?.roles ?? [],
  permissionVersion: String(claims.permission_version ?? '0'),
};
```

`permission_version` is an application-defined signed claim in this fragment. Tenant/user cache
namespaces include `permissionVersion`, roles, and resolved permissions.

## Trusted gateway alternative

If a gateway, rather than JWT, establishes identity, configure
`context.identity.trustedHeaders.isTrustedRequest` with a real mTLS/signed/proxy-boundary check.
Do not send a forged `X-User-Id` in tests and call the feature complete: add a negative test proving
that the same headers without gateway proof return 401.
