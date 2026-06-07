---
"@sdcorejs/nestjs": major
---

1.0.0 — first stable release.

Clean-break public API standardization: removed `Sd*` type aliases, the `/tenancy`
re-export of ORM decorators, the `/orm` re-export of `@sdcorejs/utils/fns`, and
internal-helper/metadata-key leaks from module barrels (orm/context/cache/validation/i18n,
file-storage). Declared `ioredis` as an optional peer dependency. Bundled per-format type
declarations so `exports` resolve cleanly under ESM and CJS (publint + attw green). Added
`publint` + `attw` validation. See `docs/migration-1.0.md`.
