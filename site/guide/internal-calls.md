# Internal service calls

`InternalGuard` protects selected routes with `X-Internal-Secret`. It compares the supplied value
in constant time and can accept multiple active keys during rotation.

## Built-in environment provider

```ts
import { Controller, Post, UseGuards } from '@nestjs/common';
import { SdCoreModule } from '@sdcorejs/nestjs';
import { InternalGuard } from '@sdcorejs/nestjs/auth';

SdCoreModule.forRoot({
  internalSecret: { envVar: 'INTERNAL_SECRET_KEY' },
});

@Controller('internal/reindex')
export class ReindexController {
  @Post()
  @UseGuards(InternalGuard)
  run() {
    return { accepted: true };
  }
}
```

If the environment variable is absent, no present header can match. If no provider is registered at
all, using `InternalGuard` returns a configuration error at request time.

## Rotating provider

```ts
import { Injectable } from '@nestjs/common';
import { SdCoreModule } from '@sdcorejs/nestjs';
import {
  INTERNAL_SECRET_PROVIDER,
  type IInternalSecretProvider,
} from '@sdcorejs/nestjs/auth';

@Injectable()
class RotatingInternalSecretProvider implements IInternalSecretProvider {
  getKey(): string {
    return process.env.INTERNAL_SECRET_CURRENT ?? '';
  }

  getKeys(): string[] {
    return [
      process.env.INTERNAL_SECRET_CURRENT,
      process.env.INTERNAL_SECRET_NEXT,
    ].filter((value): value is string => Boolean(value));
  }
}

SdCoreModule.forRoot({
  providers: [{
    provide: INTERNAL_SECRET_PROVIDER,
    useClass: RotatingInternalSecretProvider,
  }],
});
```

When `getKeys()` exists, the guard checks those values and ignores `getKey()`. Keep the overlap
window short.

## Enrich trusted context after authentication

```ts
import { Injectable } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import { SdCoreModule } from '@sdcorejs/nestjs';
import { ContextService } from '@sdcorejs/nestjs/core';
import {
  INTERNAL_CONTEXT_ENRICHER,
  type IInternalContextEnricher,
} from '@sdcorejs/nestjs/auth';

@Injectable()
class InternalContextEnricher implements IInternalContextEnricher {
  constructor(private readonly context: ContextService) {}

  enrich(request: IncomingMessage): void {
    const tenant = request.headers['x-tenant'];
    if (typeof tenant === 'string') this.context.set('tenant', tenant);
    this.context.set('custom', { internalCaller: 'inventory-service' });
  }
}

SdCoreModule.forRoot({
  providers: [{
    provide: INTERNAL_CONTEXT_ENRICHER,
    useClass: InternalContextEnricher,
  }],
});
```

The enricher runs only after the secret matches. It does not replace tenancy or resource
authorization: validate every enriched value and keep downstream policies active.

## Outbound call

```ts
import { Injectable } from '@nestjs/common';
import { HttpService } from '@sdcorejs/nestjs/services';

@Injectable()
class InventoryClient {
  constructor(private readonly http: HttpService) {}

  reindex(productIds: string[], internalSecret: string) {
    return this.http.post(
      '/internal/reindex',
      { productIds },
      { headers: { 'x-internal-secret': internalSecret } },
    );
  }
}
```

Configure the destination origin in `http.trustedOrigins`; otherwise the client strips
`x-internal-secret`. The client never generates this secret for you.

Internal shared secrets complement, not replace, TLS, network policy, rate limits, and service
identity. Prefer workload identity/mTLS where available.
