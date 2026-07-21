# Request context API

Import path: `@sdcorejs/nestjs/core`

`ContextModule` installs middleware backed by Node.js `AsyncLocalStorage`. It captures transport
metadata for each HTTP request and exposes verified identity to downstream repositories, guards and
services without request-scoping the Nest dependency graph.

## Exports

| Export | Kind | Purpose |
| --- | --- | --- |
| `ContextModule`, `ContextModuleOptions` | class/type | Global context module and `forRoot` options |
| `ContextService` | class | Read/write the active request store |
| `ContextMiddleware` | class | Nest middleware applied to all routes by `ContextModule` |
| `RequestContext` | interface | Canonical per-request store |
| `HeadersConfig` | interface | Tenant/user/language and custom header mapping |
| `ContextIdentityOptions` | interface | Principal resolver and optional trusted-header mode |
| `ResolvedContextIdentityOptions` | interface | Fully resolved DI configuration |
| `ResolvedContextIdentity` | interface | Validated identity fields |
| `IdentityContextSource` | type | `'trusted-headers' \| 'verified-principal'` |
| `TrustedHeaderIdentityOptions` | interface | Gateway verifier and optional header mapper |
| `VerifiedPrincipalResolver` | type | Maps verified `req.user` to canonical identity |
| `defaultVerifiedPrincipalResolver` | function | Maps common claim names conservatively |
| `normalizeContextIdentity` | function | Runtime-checks/clones identity values |
| `CONTEXT_HEADERS_CONFIG`, `CONTEXT_IDENTITY_CONFIG` | values | DI tokens |

## Configure verified identity

```ts
import { z } from 'zod';

const PrincipalSchema = z.object({
  sub: z.string().min(1),
  organization_id: z.string().min(1).max(64),
  realm_access: z.object({ roles: z.array(z.string().min(1)) }).optional(),
  permissions_version: z.string().min(1).optional(),
});

ContextModule.forRoot({
  headers: {
    lang: ['accept-language', 'x-language'],
    customHeaders: { correlationId: 'x-correlation-id' },
  },
  identity: {
    principalResolver: async (principal: unknown) => {
      const claims = PrincipalSchema.parse(principal);
      return {
        userId: claims.sub,
        tenant: claims.organization_id,
        roles: claims.realm_access?.roles ?? [],
        permissionVersion: claims.permissions_version,
      };
    },
  },
});
```

Default headers are `x-tenant`, `x-user-id`, and language priority
`accept-language`, `x-language`. Identity headers are **not trusted by default**. Language and the
raw `Authorization` header are transport metadata; they do not establish an authenticated user.

The default principal resolver accepts nonblank string or finite-number `sub`, `userId`, or `id`
claims and optional `tenant`, `tenantId`, and `permissionVersion` values, normalizing finite numbers
to strings. `roles` and `permissions` must be string arrays; other shapes fail.

## Explicit trusted-header mode

```ts
import { UnauthorizedException } from '@nestjs/common';

function requiredIdentityHeader(value: string | string[] | undefined, name: string): string {
  if (typeof value !== 'string') throw new UnauthorizedException(`Missing ${name}`);
  const normalized = value.trim();
  if (!normalized || normalized.length > 64 || !/^[A-Za-z0-9._:-]+$/.test(normalized)) {
    throw new UnauthorizedException(`Invalid ${name}`);
  }
  return normalized;
}

ContextModule.forRoot({
  identity: {
    trustedHeaders: {
      isTrustedRequest: (req) => req.socket.remoteAddress === '10.20.0.15',
      resolve: (req) => ({
        userId: requiredIdentityHeader(req.headers['x-user-id'], 'x-user-id'),
        tenant: requiredIdentityHeader(req.headers['x-tenant'], 'x-tenant'),
      }),
    },
  },
});
```

`isTrustedRequest` must validate a real boundary such as mTLS, a verified proxy address behind
correct proxy configuration, or signed headers. If identity headers are present and the verifier returns anything other than `true`, the
middleware throws 401. `AuthGuard` later compares overlapping trusted-header identity against the
verified Passport principal and rejects conflicts.

## `RequestContext`

```ts
interface RequestContext {
  userId?: string;
  tenant?: string;
  roles?: string[];
  lang?: string;
  token?: string;
  user?: unknown;
  permissions?: string[];
  permissionVersion?: string;
  identitySource?: 'trusted-headers' | 'verified-principal';
  request?: IncomingMessage;
  response?: ServerResponse;
  custom?: Record<string, unknown>;
}
```

Use `custom` or declaration merging for domain-specific fields. Never put reusable global state in
the request store.

## `ContextService`

| Member | Signature / result |
| --- | --- |
| `run` | `run<R>(store, fn): R` starts an ALS scope |
| `store` | Current `RequestContext \| undefined` |
| `get` / `set` | Typed key access to the active store; `set` is a no-op outside a scope |
| `setIdentity` | Replaces security-sensitive fields atomically and records their source |
| `getCustom<T>` | Reads `custom[key]` |
| `userId`, `tenant`, `lang`, `token`, `user`, `permissionVersion` | Convenience getters |
| `roles`, `permissions` | Convenience getters; return `[]` when absent |
| `hasPermission` | Exact membership check in resolved permissions |

```ts
@Injectable()
export class OrdersService {
  constructor(private readonly context: ContextService) {}

  currentBoundary() {
    return {
      tenant: this.context.tenant,
      actor: this.context.userId,
      correlationId: this.context.getCustom<string>('correlationId'),
    };
  }
}
```

## Security notes

- Treat `token`, `request`, `response`, and `user` as sensitive runtime references; do not log or
  serialize the full context.
- Do not call `setIdentity` from arbitrary request handlers. `AuthGuard` uses it only after JWT
  verification and conflict checking.
- Async work detached from the request can outlive the context. Pass explicit values to queues or
  jobs rather than assuming ALS is available later.
