# Permissions and internal-call API

Import path: `@sdcorejs/nestjs/auth`

This entrypoint provides two independent guards: `AuthGuard` authenticates a JWT and checks route
permissions; `InternalGuard` authenticates service-to-service calls with a rotating shared-secret
provider.

## Permission exports

| Export | Kind | Purpose |
| --- | --- | --- |
| `IPermissionStrategy` | interface | Loads and optionally interprets permission codes |
| `DefaultPermissionStrategy` | class | Deny-all default |
| `PERMISSION_STRATEGY` | value | Strategy DI token |
| `PERMISSION_METADATA_KEY` | value | Decorator metadata key |
| `HasPermission` | decorator | Requires one code |
| `HasAnyPermission` | decorator | Requires any supplied code (OR) |
| `AuthGuard` | class | Passport `jwt` guard plus verified identity and permission checks |
| `PermissionModule`, `PermissionModuleOptions` | class/type | Registers strategy and guards globally |

```ts
@Injectable()
export class AppPermissionStrategy implements IPermissionStrategy {
  async load(ctx: RequestContext): Promise<string[]> {
    if (!ctx.userId || !ctx.tenant) return [];
    return permissionsFor(ctx.tenant, ctx.userId);
  }

  check(codes: string[], required: string): boolean {
    const [resource] = required.split(':');
    return codes.includes(required) || codes.includes(`${resource}:*`);
  }
}

PermissionModule.forRoot({ strategy: AppPermissionStrategy });
```

```ts
@UseGuards(AuthGuard)
@HasAnyPermission('product:read', 'product:admin')
@Get(':id')
detail() {}
```

`AuthGuard` always runs Passport authentication, even when a route has no permission metadata. It
maps verified `req.user` into `ContextService`, rejects conflicts with an existing trusted-gateway
identity, and then evaluates permissions. Required codes use OR semantics. Permissions are loaded
at most once per request and mirrored into the context. A verified principal's explicit
`permissions` array can satisfy the cache without calling `load`.

The default `check` is exact `Array.includes`. Missing permissions throw 403 with code
`core.permission.forbidden`; missing or invalid verified principals throw non-enumerating 401
errors.

## Internal-call exports

| Export | Kind | Purpose |
| --- | --- | --- |
| `IInternalSecretProvider` | interface | Current key and optional rotating key set |
| `INTERNAL_SECRET_PROVIDER` | value | Secret-provider DI token |
| `EnvInternalSecretProvider` | class | Reads an env variable; default `INTERNAL_SECRET_KEY` |
| `IInternalContextEnricher` | interface | Trusted context hook called after secret verification |
| `INTERNAL_CONTEXT_ENRICHER` | value | Enricher DI token |
| `InternalGuard` | class | Constant-time shared-secret guard |
| `INTERNAL_SECRET_HEADER` | value | Default header: `x-internal-secret` |

### Configure a rotating provider

```ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';

function requiredIdentityHeader(value: string | string[] | undefined, name: string): string {
  if (typeof value !== 'string') throw new UnauthorizedException(`Missing ${name}`);
  const normalized = value.trim();
  if (!normalized || normalized.length > 64 || !/^[A-Za-z0-9._:-]+$/.test(normalized)) {
    throw new UnauthorizedException(`Invalid ${name}`);
  }
  return normalized;
}

@Injectable()
export class RotatingInternalSecrets implements IInternalSecretProvider {
  async getKey(): Promise<string> {
    return secretStore.current();
  }

  async getKeys(): Promise<string[]> {
    return secretStore.currentAndPrevious();
  }
}

@Injectable()
export class InternalIdentity implements IInternalContextEnricher {
  constructor(private readonly context: ContextService) {}

  enrich(req: IncomingMessage): void {
    const tenant = requiredIdentityHeader(req.headers['x-tenant'], 'x-tenant');
    const caller = requiredIdentityHeader(req.headers['x-caller'], 'x-caller');
    this.context.set('tenant', tenant);
    this.context.set('custom', { caller });
  }
}

SdCoreModule.forRoot({
  providers: [
    { provide: INTERNAL_SECRET_PROVIDER, useClass: RotatingInternalSecrets },
    { provide: INTERNAL_CONTEXT_ENRICHER, useClass: InternalIdentity },
  ],
});
```

If `getKeys` exists, `InternalGuard` accepts any returned key and does not call `getKey`. It uses
`timingSafeEqual`; length differences fail before comparison. The enricher runs only after a valid
secret.

```ts
@UseGuards(InternalGuard)
@Post('reindex')
reindex() {}
```

### Errors

| Condition | Status | Code |
| --- | --- | --- |
| Provider not registered | 500 | `core.permission.internal-secret-provider-missing` |
| Header missing | 403 | `core.permission.internal-secret-missing` |
| No key matches | 403 | `core.permission.internal-secret-mismatch` |

## Security notes

- Prefer `getKeys()` during rotation, then remove the previous key after callers migrate.
- `EnvInternalSecretProvider` returns no valid keys when its variable is absent, so routes remain
  closed. Treat the 500 as an operational misconfiguration.
- Send the internal secret only to an exact trusted origin. [`HttpService`](../services/http.md)
  strips it from untrusted requests and redirects but never creates the secret header for you.
- Do not derive trusted tenant/user context before the secret check; put that work in
  `IInternalContextEnricher`.
- Route permission decorators are metadata, not a guard registration. Always apply `AuthGuard`
  locally or globally.
