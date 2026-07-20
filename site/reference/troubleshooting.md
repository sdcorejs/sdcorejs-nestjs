# Troubleshooting

## Scoped repository throws at first query

`MissingTenancyContextError` means a scoped entity has no active tenancy strategy. Import
`TenancyModule`/configure `SdCoreModule.tenancy`, then ensure the request is inside
`ContextMiddleware`. `MissingTenancyScopeError` means the strategy omitted a required `@Scoped()`
property; do not turn that failure into an unscoped query.

## `@Cached()` does nothing

The decorator only stores metadata. Register `CacheInterceptor` globally with `APP_INTERCEPTOR` or
apply `@UseInterceptors(CacheInterceptor)` to the controller. Then check that the method returns one
value (not a stream) and that its declared scope has the required trusted context.

## Redis startup fails with an invalid prefix

Set a unique `cache.redis.keyPrefix` that is nonblank and contains none of `*`, `?`, `[`, `]`, or
backslash. This failure prevents one application from scanning/deleting another application's keys.

## JWKS strategy fails during construction

Declare at least one issuer policy: exact `allowedIssuers`, trusted origins in
`allowedIssuerHosts`, or an `issuerValidator`. Configure either `jwks` or `secret`, never both.
Install `jwks-rsa` and `jsonwebtoken` when optional dependency installation was disabled.

## Cookie authentication works for bearer but not browser requests

Set a nonblank `cookieName`; bearer extraction has priority and the named cookie is the fallback in
both symmetric and JWKS strategies. Your HTTP adapter must populate `request.cookies` (for example
with cookie-parser). The library does not parse the Cookie header itself.

## S3 unexpectedly uses local storage

Set `driver: 's3'` and a nonblank `bucket`. Use the AWS default provider chain by omitting both
`accessId` and `accessKey`, or configure both as nonblank strings. Partial/blank credentials fail at
module configuration. An explicit local driver may retain a complete dormant S3 tuple.

## Upload returned 400 but an object may exist

The service keeps the database row hidden in pending state until activation. Run the trusted
pending-deletion maintenance worker; do not delete arbitrary keys from request input. Inspect logs
and reconcile object inventory with database keys if the outage crossed both systems.

## Scheduled job runs again after a crash

A stale lease is reclaimable by design. Use the stable `idempotencyKey` in the callback for outbox or
downstream deduplication. Do not use `ownerToken` as a business idempotency key; it rotates on every
reclaim.

## Package import or DI identity fails

Use one of the eight documented imports, keep compatible Nest/TypeORM versions hoisted, and avoid
deep `/dist` imports. Run `npm ls`, the package's export check, and the DI smoke test in a clean
install.
