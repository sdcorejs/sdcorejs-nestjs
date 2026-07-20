# Request context and identity

`ContextModule` creates one `RequestContext` per HTTP request with Node's
`AsyncLocalStorage`. `ContextService` stays a singleton, so using it does not turn the application
DI graph into request scope.

```ts
import { Injectable } from '@nestjs/common';
import { ContextService } from '@sdcorejs/nestjs/core';

@Injectable()
export class PricingService {
  constructor(private readonly context: ContextService) {}

  quote() {
    return {
      tenant: this.context.tenant,
      userId: this.context.userId,
      currency: this.context.getCustom<string>('currency'),
    };
  }
}
```

## What is populated before authentication

The middleware always records the raw language header, authorization header, request, and response.
It does not treat ordinary identity headers as trusted. Without an explicit trusted-gateway mode,
`X-Tenant`, `X-User-Id`, and configured custom identity headers do not populate security fields.

After Passport verifies a JWT, `AuthGuard` maps `req.user` with the configured
`principalResolver`, atomically replaces security-sensitive context values, and marks the source as
`verified-principal`.

```ts
import type { TLSSocket } from 'node:tls';
import { SdCoreModule } from '@sdcorejs/nestjs';
import { z } from 'zod';

const AppPrincipalSchema = z.object({
  id: z.string().min(1),
  tenantCode: z.string().min(1).max(64),
  roleCodes: z.array(z.string().min(1)),
});

SdCoreModule.forRoot({
  context: {
    identity: {
      principalResolver: (principal: unknown) => {
        const user = AppPrincipalSchema.parse(principal);
        return {
          userId: user.id,
          tenant: user.tenantCode,
          roles: user.roleCodes,
        };
      },
    },
  },
});
```

The resolver must return a nonblank `userId`. Throwing, returning an invalid identity, or reaching a
guarded route without `req.user` yields 401.

## Trusted gateway mode

Use header identity only when the application can prove that the request crossed a trusted gateway
boundary. The verifier must validate something the public caller cannot forge, such as a verified
mTLS peer, a trusted proxy address after correct proxy configuration, or a signed-header envelope.

```ts
import { SdCoreModule } from '@sdcorejs/nestjs';

SdCoreModule.forRoot({
  context: {
    headers: {
      tenant: 'x-tenant',
      userId: 'x-user-id',
      customHeaders: { departmentCode: 'x-department-code' },
    },
    identity: {
      trustedHeaders: {
        isTrustedRequest: (request) =>
          (request.socket as TLSSocket).authorized === true,
      },
    },
  },
});
```

::: warning
The snippet assumes your HTTPS/mTLS server sets `request.socket.authorized`. If your deployment does
not terminate verified client certificates in the NestJS process, implement a verifier appropriate
to the real proxy boundary. Never return `true` unconditionally.
:::

If any configured identity header is present and verification fails, the middleware rejects the
request with 401. If trusted header identity and the later verified principal supply conflicting
values, `AuthGuard` also rejects with 401.

## Extending context safely

Prefer the `custom` bag for domain values:

```ts
const department = context.getCustom<string>('departmentCode');
```

Declaration merging is available when a direct property improves ergonomics:

```ts
declare module '@sdcorejs/nestjs/core' {
  interface RequestContext {
    requestChannel?: 'web' | 'mobile';
  }
}
```

Security-sensitive consumers such as cache namespaces inspect JSON-safe domain fields. Keep context
values plain, bounded data. Do not store secrets, database connections, class instances, cycles, or
large graphs in `custom`.

## Background work

There is no HTTP middleware in a queue worker or CLI command. Establish an explicit context only
when the work genuinely runs on behalf of one tenant/user:

```ts
await context.run(
  { tenant: job.tenantCode, userId: job.actorId, identitySource: 'verified-principal' },
  () => applicationService.execute(job.payload),
);
```

The `identitySource` value in this example is an application assertion. Populate it only from
already authenticated, integrity-protected job data; never copy untrusted payload fields directly.
