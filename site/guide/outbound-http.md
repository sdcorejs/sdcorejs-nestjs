# Outbound HTTP

`HttpService` wraps Axios and returns response data directly. Context identity headers propagate
only to exact trusted HTTP(S) origins.

## Configure exact origins

```ts
import { SdCoreModule } from '@sdcorejs/nestjs';

SdCoreModule.forRoot({
  context: {
    headers: {
      tenant: 'x-tenant',
      userId: 'x-user-id',
      customHeaders: { departmentCode: 'x-department-code' },
    },
  },
  http: {
    baseURL: 'https://inventory.internal.example',
    timeout: 10_000,
    trustedOrigins: ['https://inventory.internal.example'],
  },
});
```

Origins are normalized with the URL parser. Paths are ignored; scheme, hostname, and effective port
must match. Subdomains, lookalike names, alternate ports, non-HTTP protocols, and arbitrary absolute
URLs do not match.

Before each request, the client removes configured identity headers supplied by the caller. For a
trusted origin it rebuilds them from `ContextService`; for an untrusted origin it leaves them
absent. Redirects apply the same decision again at every destination.

`Authorization` remains caller-owned. `x-internal-secret` also remains caller-supplied, but it is
stripped from untrusted requests and redirects.

## Use the client

```ts
import { Injectable } from '@nestjs/common';
import { HttpService } from '@sdcorejs/nestjs/services';

interface InventoryItem {
  id: string;
  available: boolean;
}

@Injectable()
class InventoryClient {
  constructor(private readonly http: HttpService) {}

  detail(id: string): Promise<InventoryItem> {
    return this.http.get<InventoryItem>('/items/' + encodeURIComponent(id));
  }

  reserve(id: string, quantity: number): Promise<{ reservationId: string }> {
    return this.http.post('/reservations', { id, quantity });
  }
}
```

Methods `get`, `post`, `put`, `patch`, and `delete` accept the corresponding Axios request
configuration and return `response.data`.

## Limit propagated fields

```ts
http: {
  baseURL: 'https://inventory.internal.example',
  trustedOrigins: ['https://inventory.internal.example'],
  propagateHeaders: ['x-tenant', 'x-department-code'],
},
```

This fragment belongs inside `SdCoreModule.forRoot({...})`. Listing `authorization` or
`x-internal-secret` here has no effect; both are intentionally excluded.

## Trust-domain checklist

- Allowlist only services that accept the same identity semantics.
- Authenticate the service separately with mTLS, workload identity, or an application credential.
- Do not trust a propagated user header on a public endpoint.
- Keep external absolute URLs out of internal client methods where possible.
- Test trusted-to-untrusted redirects and verify identity/secret headers are absent.
