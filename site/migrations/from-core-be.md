# Migrate from `core-be`

The full import/entity/operator walkthrough is maintained in
[docs/migration-from-core-be.md](https://github.com/sdcorejs/sdcorejs-nestjs/blob/main/docs/migration-from-core-be.md).

Treat this as two explicit migrations:

1. Move legacy imports and domain-specific base infrastructure to the eight supported
   `@sdcorejs/nestjs` entry points, DI strategies, decorators, and feature entities.
2. Apply every 1.1.0 security invariant in the [1.0 → 1.1 guide](/migrations/1.0-to-1.1), even if the
   application never published against package version 1.0.

Do not mechanically map legacy tenant headers, raw repositories, boolean bypass, public storage
keys, unscoped caches, or check-then-insert job locks. Those are trust-boundary changes that require
application decisions and migration tests.
