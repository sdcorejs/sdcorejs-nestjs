# Architecture

The package is organized around one request-scoped security context and a set of DI policies.

```text
HTTP request
  └─ ContextMiddleware (AsyncLocalStorage)
       ├─ AuthGuard → verified principal → permissions
       ├─ BaseController → BaseService → BaseRepository
       │                              ├─ tenancy predicates
       │                              ├─ audit fields
       │                              └─ optional action-history record
       ├─ CacheInterceptor → mandatory security namespace
       └─ HttpService → identity headers only to trusted origins
```

## Mechanism versus policy

The library owns reusable mechanics:

- propagating request context without request-scoped DI;
- adding tenant predicates to repository operations;
- fencing distributed jobs with database leases;
- normalizing response and validation envelopes; and
- applying bounded, non-enumerating file and history access paths.

The application owns policy:

- mapping a verified token to `userId`, tenant, roles, and custom claims;
- granting permissions and privileged tenancy bypasses;
- deciding whether file or history reads are allowed;
- choosing data retention; and
- deduplicating external job side effects.

## Module layers

| Import | Layer |
| --- | --- |
| `@sdcorejs/nestjs` | root composition and common tokens/types |
| `@sdcorejs/nestjs/core` | context, tenancy, ORM, audit |
| `@sdcorejs/nestjs/auth` | JWT, permissions, internal-call guards |
| `@sdcorejs/nestjs/services` | cache and outbound HTTP |
| `@sdcorejs/nestjs/validation` | Zod v4 guards and presets |
| `@sdcorejs/nestjs/i18n` | language and message resolution |
| `@sdcorejs/nestjs/features` | uploaded files, history, job leases |
| `@sdcorejs/nestjs/queue` | BullMQ connection, decorators, worker base |

## Fail-closed boundaries

- Header identity is ignored unless `trustedHeaders.isTrustedRequest()` succeeds.
- JWT verification requires a secret or an explicit JWKS issuer policy.
- A scoped entity without usable tenancy context throws before SQL.
- A privileged tenant bypass needs an actor, reason, target/operation allowlists, and a synchronous
  audit callback.
- `InternalGuard` rejects calls when its secret provider is absent or mismatched.
- File and history policies return the same 404 for absent and unauthorized resources.
- Tenant/user caches bypass caching when their required identity namespace cannot be built safely.

## Stateful boundaries

Object storage, PostgreSQL, and external APIs do not share one transaction. Uploaded files first
persist a hidden pending row, then write the object, then activate the row. Failed writes,
activations, and deletions retain a durable cleanup claim. Scheduled jobs expose a stable
`idempotencyKey`, but the application must use that key in an outbox or downstream deduplication
record before making an external effect.
