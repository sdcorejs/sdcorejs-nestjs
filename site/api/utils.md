# Utilities API

Import path: `@sdcorejs/nestjs/utils`.

## SingleFlightService

`SingleFlightService` shares pending work for a string key within one instance in one process.
`run<T>(key, factory): Promise<T>` accepts a synchronous value or a Promise-like result. The first
factory starts immediately after registration; concurrent callers receive the same promise and result/error.
Successful results, rejected promises and synchronous throws are removed before callers observe
settlement. A later call runs a new factory. There is no result cache or automatic retry.

Register the class in your module's providers and export that provider if other modules should
share it, or keep a private instance for an independent namespace. It is not automatically global.
Different keys and instances proceed independently. The same key must always describe equivalent
work with the same result type, even when callers pass different factories.

## Non-cache work

```ts
import { Injectable, Module } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { SingleFlightService } from '@sdcorejs/nestjs/utils';

@Injectable()
export class DiscoveryService {
  constructor(private readonly flights: SingleFlightService) {}

  read<T>(trusted: {
    tenant: string; realm: string; clientId: string;
    credentialVersion: string; permissionVersion: string;
    userId: string; permissions: string[]; resourceId: string;
  }, fetchAuthorized: () => Promise<T>): Promise<T> {
    const key = createHash('sha256').update(JSON.stringify([
      'discovery:v1', trusted.tenant, trusted.realm, trusted.clientId,
      trusted.credentialVersion, trusted.permissionVersion, trusted.userId,
      [...trusted.permissions].sort(), trusted.resourceId,
    ])).digest('hex');
    return this.flights.run(key, fetchAuthorized);
  }
}

@Module({ providers: [SingleFlightService, DiscoveryService] })
export class DiscoveryModule {}
```

Authorize each caller before joining a flight. Build keys from trusted server context and include
all inputs that affect the result, including tenant, realm, client, credential version, user and
permission scope. Hashing does not authorize access. Never include credentials or log raw keys,
tokens or secret values. The utility itself performs no logging or authorization.

## Cache work

Use `CacheService.load` when the result should also be cached; it already uses separate internal
single-flight instances for reads and factories. No extra wrapper is required.

```ts
import { CacheService } from '@sdcorejs/nestjs/services';

export async function cachedRead<T>(
  cache: CacheService,
  trustedScopedKey: string,
  fetchAuthorized: () => Promise<T>,
): Promise<T> {
  return cache.load(trustedScopedKey, fetchAuthorized, 60);
}
```

The same trusted-key rules apply to direct cache calls. `@Cached` continues to build its own
tenant/user scope. See [Cache API](./services/cache).

## Lifetime and limits

There is no cancellation, deadline, eviction or concurrency-limit API. A factory that never
settles keeps its key and waiters pending; consumers must bound the underlying operation.
Do not tie shared work to one caller's abort signal unless aborting every waiter is intended.
A timeout that stops waiting does not prove the underlying side effect stopped.

A factory must not await its own flight, directly or indirectly; same-key dependency cycles
can remain pending. Different-key composition is allowed if it has no cycle. This utility is
not a database lock, distributed lock or durable idempotency guarantee. Other processes and
later calls can execute the operation again.
