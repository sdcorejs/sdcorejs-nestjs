# Security checklist

Use this list as a deployment gate; it complements the repository's
[security policy](https://github.com/sdcorejs/sdcorejs-nestjs/blob/main/SECURITY.md).

## Identity and authorization

- Map tenant/user identity from a verified Passport principal. Leave header identity disabled unless
  `trustedHeaders.isTrustedRequest` verifies a real gateway boundary.
- At the gateway, strip client identity headers before writing trusted values. Treat conflicts
  between principal and gateway identity as authentication failures.
- Configure a JWKS issuer policy (`allowedIssuers`, `allowedIssuerHosts`, or `issuerValidator`) and
  restrict algorithms/audience. Never configure both symmetric `secret` and `jwks`.
- Protect resource methods with application permissions. Authentication alone is not file/history
  resource authorization.
- Load internal-call secrets from an environment/provider, support rotation with `getKeys()`, and run
  context enrichment only after `InternalGuard` succeeds.

## Database and tenancy

- Decorate every shared-database scope dimension with `@Scoped()`; required is the default.
- Ensure each scoped repository receives a tenancy strategy and test tenant/user/department
  cross-matrices. Empty allowed arrays must stay deny-all.
- Use structured, target/operation-bounded, synchronously audited bypass grants. Boolean bypasses do
  not grant access.
- Keep `unsafeRepository`, `unsafeGetRepository`, and `unsafeCreateQueryRunner` out of request paths.
- Use active caller transactions for scoped multi-step mutation; verify affected-row counts.

## Cache and HTTP

- Register `CacheInterceptor` (`APP_INTERCEPTOR` or `@UseInterceptors`) before relying on `@Cached()`.
- Choose tenant/user cache scope for identity-dependent data. `global` is for truly identical public
  results only.
- Give Redis a unique nonblank, glob-free application/environment/release prefix.
- Configure exact trusted HTTP(S) origins. Do not propagate identity to arbitrary URLs, lookalike
  hosts, ports, or cross-origin redirects.

## Files, history, and jobs

- Keep storage private by default. Configure nonblank S3 bucket and either the SDK provider chain or
  a complete nonblank access-key pair.
- Keep remote clone disabled unless required; use host allowlists plus tight timeout/size/redirect
  bounds and an outbound network policy.
- Run pending-file maintenance and storage/database inventory reconciliation. Never expose
  `unsafeSystem*` methods from a controller.
- Configure action-history read authorization, tenant resolution, mandatory redaction, and an
  application-owned retention process.
- Use `JobExecutionLease.idempotencyKey` in a unique transactional outbox or downstream
  `Idempotency-Key`. Owner-token fencing does not make external effects exactly once.

## Operations

- Run supported Node.js and NestJS versions, apply explicit PostgreSQL migrations, back up before
  schema/object-key changes, and keep TypeORM synchronization off in production.
- Run package, test, export, docs, link, API-coverage, and dependency-audit gates before release.
- Report vulnerabilities through GitHub private security advisories, never a public issue.
