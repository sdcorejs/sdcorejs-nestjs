# Internal (service-to-service) calls

`InternalGuard` gates internal-only endpoints with a shared secret in the `X-Internal-Secret` header,
compared in constant time. Two DI hooks make it production-ready.

## 1. Provide the secret — `IInternalSecretProvider`

```ts
import { Injectable } from '@nestjs/common';
import type { IInternalSecretProvider } from '@sdcorejs/nestjs/auth';

@Injectable()
export class AppInternalSecretProvider implements IInternalSecretProvider {
  getKey(): string {
    return process.env.INTERNAL_SECRET!;
  }
  // Optional — zero-downtime rotation: return BOTH the outgoing and incoming secret during
  // the transition window. When present, the guard accepts a match against ANY key.
  getKeys(): string[] {
    return [process.env.INTERNAL_SECRET!, process.env.INTERNAL_SECRET_NEXT!].filter(Boolean);
  }
}
```

The built-in `EnvInternalSecretProvider` covers the common case — wire it with
`SdCoreModule.forRoot({ internalSecret: { envVar: 'INTERNAL_SECRET_KEY' } })`.

## 2. Carry trusted context — `IInternalContextEnricher` (optional)

Internal calls arrive with no authenticated user. The enricher runs **only after the secret check
passes**, so context derived from inbound headers is trusted on verified internal traffic and never on
public traffic.

```ts
import { Injectable } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import { ContextService } from '@sdcorejs/nestjs/core';
import type { IInternalContextEnricher } from '@sdcorejs/nestjs/auth';

@Injectable()
export class AppInternalEnricher implements IInternalContextEnricher {
  constructor(private readonly ctx: ContextService) {}
  enrich(req: IncomingMessage): void {
    const h = req.headers;
    this.ctx.set('tenant', h['x-tenant'] as string);
    this.ctx.set('userId', h['x-user-id'] as string);
    this.ctx.set('custom', { isInternalCall: true, caller: h['x-caller'] });
  }
}
```

## Apply per route

```ts
import { Controller, Post, UseGuards } from '@nestjs/common';
import { InternalGuard } from '@sdcorejs/nestjs/auth';

@Controller('internal/sync')
@UseGuards(InternalGuard)
export class SyncController { /* ... */ }
```

With no secret provider registered, the guard throws `500` at request time (not at boot), keeping the DI
graph bootable.

::: tip
The enricher sets `custom.isInternalCall`, which your `ITenancyStrategy.shouldBypass()` can read to skip
tenant filtering on internal calls.
:::
