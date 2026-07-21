# HTTP client API

Import path: `@sdcorejs/nestjs/services`

`HttpService` wraps Axios and propagates configured request-context identity headers only to exact
trusted HTTP(S) origins. It re-evaluates trust on redirects.

## Exports

| Export | Kind | Purpose |
| --- | --- | --- |
| `HttpClientConfig` | interface | Base URL, timeout and propagation policy |
| `HTTP_CLIENT_CONFIG` | value | Config DI token |
| `HttpService` | class | Axios-backed `get`/`post`/`put`/`patch`/`delete` API |
| `HttpClientModule` | class | Global provider module; `forRoot(config?)` |

## Configuration

```ts
HttpClientModule.forRoot({
  baseURL: 'https://inventory.internal.example/v1',
  timeout: 10_000,
  trustedOrigins: ['https://inventory.internal.example'],
  propagateHeaders: ['x-tenant', 'x-user-id', 'x-correlation-id'],
});
```

| Option | Default | Behavior |
| --- | --- | --- |
| `baseURL` | Axios default | Resolves relative request URLs |
| `timeout` | `30_000` ms | Axios request timeout |
| `trustedOrigins` | `[]` | Exact normalized HTTP(S) origins allowed to receive identity headers |
| `propagateHeaders` | Configured context identity headers | Selected identity header names |

`trustedOrigins` values may contain paths, but only `new URL(value).origin` is retained. Scheme,
host and effective port must all match. Subdomains and lookalike suffixes do not match. Invalid or
non-HTTP(S) entries throw at construction.

## Methods

```ts
get<T>(url: string, config?: AxiosRequestConfig): Promise<T>
post<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T>
put<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T>
patch<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T>
delete<T>(url: string, config?: AxiosRequestConfig): Promise<T>
```

Each method returns `AxiosResponse.data`, not the full Axios response.

```ts
@Injectable()
export class InventoryGateway {
  constructor(private readonly http: HttpService) {}

  reserve(productId: string, quantity: number) {
    return this.http.post<{ reservationId: string }>('/reservations', {
      productId,
      quantity,
    });
  }
}
```

## Header propagation rules

The client derives values from `ContextService` and `HeadersConfig`:

- `tenant` maps to the configured tenant header (default `x-tenant`).
- `userId` maps to the configured user header (default `x-user-id`).
- `custom` values map through `HeadersConfig.customHeaders`.

Before each request, configured identity headers are removed from caller-supplied headers. They are
repopulated from trusted context only when the target origin is allowlisted. This prevents callers
from smuggling a forged identity header through the wrapper.

`authorization` is always caller-owned and is excluded from context propagation. The
`x-internal-secret` header is also caller-supplied; it is retained only for an exact trusted origin
and removed from untrusted targets. On every redirect, identity headers are removed and then
repopulated only if the redirect target is independently trusted. A consumer `beforeRedirect` hook
runs first, after which the security policy is enforced.

```ts
await http.post(
  'https://inventory.internal.example/reindex',
  {},
  { headers: { 'x-internal-secret': await secrets.current() } },
);
```

## Security notes

- Keep `trustedOrigins` empty unless downstream services are explicitly authorized to receive the
  current identity.
- An absolute URL passed to a method can override `baseURL`; trust is computed from the final
  target, so it will not receive identity headers unless independently allowlisted.
- This client does not create internal secrets or bearer tokens. Attach them explicitly and apply
  separate credential rotation/least-privilege policy.
- Context propagation is not end-user authentication. The receiving service must protect its trust
  boundary, for example with [`InternalGuard`](../auth/permissions.md#internal-call-exports) or
  verified mTLS/gateway controls.
