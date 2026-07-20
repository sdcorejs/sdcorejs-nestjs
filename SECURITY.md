# Security policy

`@sdcorejs/nestjs` is infrastructure for applications that may share one database and object store
across tenants. Security therefore depends on both the library defaults and the host application's
identity, database, storage, and authorization configuration.

## Supported versions

Security fixes are provided for the latest supported release line. Older release lines,
prereleases, forks, and applications using unsupported Node.js versions are not covered. The
current code line requires Node.js 20 or newer and NestJS 11.

| Version line              | Security support                      |
| ------------------------- | ------------------------------------- |
| `1.1.x`                   | Supported                             |
| `1.0.x` and earlier       | Upgrade required                      |
| Unreleased default branch | Best effort; not a production release |

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use the repository's
[private GitHub security advisory form](https://github.com/sdcorejs/sdcorejs-nestjs/security/advisories/new)
and include:

- the affected package version, Node.js version, database, and storage driver;
- a minimal reproduction and the security boundary that was crossed;
- the expected impact, including whether another tenant or user is affected; and
- any known mitigations, without including live credentials or production data.

Please allow maintainers time to reproduce and coordinate a release before public disclosure.

## Security assumptions

- Identity fields are derived from a verified Passport/JWT principal. Header identity is disabled
  unless `context.identity.trustedHeaders` verifies a real gateway boundary. The gateway must strip
  client-supplied identity headers before setting its own values. Separately, an endpoint protected
  by `InternalGuard` may let `IInternalContextEnricher` derive context from headers only after the
  configured internal secret has been verified successfully.
- Every shared-database entity has all tenant dimensions decorated with `@Scoped()`. Required scopes
  are the default; nullable dimensions must be marked `@Scoped({ required: false })` deliberately.
- Tenant and owner values passed to `UploadedFileService` come from trusted request context. S3
  buckets and local storage are private unless public files are explicitly required and reviewed.
- Production databases are migrated explicitly. Do not rely on TypeORM `synchronize` in production.
- Authentication is not resource authorization. Consumers configure file-sharing and action-history
  policies for any access beyond the default owner-only/deny-by-default behavior.
- Secrets, tokens, credentials, and private keys do not belong in request context custom values,
  logs, cache values, job payloads, file metadata, or action-history snapshots.

## Unsafe escape hatches

The following APIs deliberately bypass ordinary protection and must not be reachable from request
data or general application services:

- `BaseRepository.unsafeRepository`, `unsafeGetRepository()`, and `unsafeCreateQueryRunner()` expose
  raw TypeORM primitives without tenancy filters, scoped-mutation guards, or affected-row checks.
- A tenancy bypass is accepted only through a structured `TenancyBypassGrant` produced after
  authentication and authorization. The grant must identify the actor and reason, restrict exact
  schema-qualified TypeORM `EntityMetadata.tablePath` targets and repository operations, and persist
  an audit event synchronously. Boolean bypass callbacks cannot grant access.
- `internalSecret: { key: 'literal' }` is deprecated and suitable only for isolated development or
  tests. Never commit or deploy a static literal secret; use `envVar` or a production
  `IInternalSecretProvider` that retrieves and rotates secrets outside application source.
- `UploadedFileService.unsafeSystemPurgeUnusedBefore()` and
  `unsafeSystemRetryPendingDeletions()` are process-wide maintenance operations for the cleanup job.
  Do not expose them through controllers or consumer-facing services.

Keep these calls in a small, reviewed maintenance boundary. Prefer a separate privileged worker
identity and record the operator, reason, target, and outcome.

## Multi-tenant deployment guidance

- Treat missing tenant context, null required scopes, and empty allowed-scope arrays as access
  failures. Never translate them to an unscoped query.
- Include every active scope (for example tenant, organization, and department) on entities and in
  the strategy result. Test a tenant/user matrix against real TypeORM queries after schema changes.
- Use `@Cached({ scope: 'tenant' | 'user' })` for security-sensitive responses. `global` is an
  explicit opt-in only for data that is identical and public across every tenant and user.
- Give every Redis-backed application/environment/release a unique, nonblank, glob-free
  `cache.redis.keyPrefix`. There is no shared default, invalid prefixes fail fast, and `clear()` /
  `size()` remain limited to that prefix even when the Redis database is shared.
- Configure `HttpClientModule` trusted origins narrowly. Identity headers must never be propagated to
  arbitrary absolute URLs or redirected external origins.
- Keep remote file cloning disabled unless required. If enabled, set an allowlist, small size and
  timeout limits, and monitor failures. The library validates every DNS answer and redirect, but an
  outbound network policy remains an important second layer.
- Treat uploaded-file database rows and objects as one consistency domain. Run the pending-deletion
  maintenance sweep, alert on repeated failures, and reconcile storage inventory with database rows.
- Job owner tokens fence database finalization, not external side effects. Use idempotency keys, a
  transactional outbox, or business-level deduplication for email, payments, and other effects.
- Define action-history retention and deletion policy for applicable privacy and compliance rules.
  Built-in secret-field redaction is a backstop, not permission to audit arbitrary sensitive data.

Review the release migration guide before deploying a version that changes these invariants.
