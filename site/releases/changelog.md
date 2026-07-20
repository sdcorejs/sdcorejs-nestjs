# Changelog

## 1.1.0

- Hardened verified identity, gateway trust, tenancy, scoped mutations, cache/HTTP propagation,
  uploaded files, action history, and distributed job leases.
- Added crash-durable pending-first uploads with explicit activation tombstones/deletion claims and
  poison-row retry backoff, stable job idempotency keys, complete core error catalogs, fail-fast
  S3/JWT configuration, safe soft-delete detail defaults, and consistent pagination caps.
- Rebuilt the documentation portal with global navigation, full public API reference, complete
  examples, operations/security references, and an explicit migration journey.
- Requires Node.js 20 or newer and coordinated consumer migration.

## 1.0.0

First stable release with grouped public entry points, dual ESM/CJS declarations, NestJS 11
composition, ORM/context/tenancy/audit/auth/services/queue/validation/i18n modules, and consolidated
uploaded-file/action-history/job-scheduler features.

For commit-level release notes, see the package
[CHANGELOG.md](https://github.com/sdcorejs/sdcorejs-nestjs/blob/main/CHANGELOG.md).
