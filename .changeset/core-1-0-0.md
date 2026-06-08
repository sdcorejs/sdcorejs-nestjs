---
"@sdcorejs/nestjs": major
---

1.0.0 — first stable release.

Clean-break public API standardization: removed `Sd*` type aliases, the `/tenancy`
re-export of ORM decorators, the `/orm` re-export of `@sdcorejs/utils/fns`, and
internal-helper/metadata-key leaks from module barrels (orm/context/cache/validation/i18n,
file-storage). Declared `ioredis` as an optional peer dependency. Bundled per-format type
declarations so `exports` resolve cleanly under ESM and CJS (publint + attw green). Added
`publint` + `attw` validation. See `docs/migration-1.0.md`. Feature modules (action-history, job-scheduler, uploaded-file) consolidated under a single `@sdcorejs/nestjs/features` entry (`src/features/`); entities live with their module; `FileEntity`→`UploadedFile`, table `file`→`uploaded_file`. Entry points grouped into core/auth/services (+ queue/validation/i18n/features). `SdCoreModule.forRoot` now composes every module (features opt-in per config key) with a built-in `internalSecret` provider and inline `tenancy` `{resolve,bypass}` callbacks. `@nestjs/bullmq` + `bullmq` are now required peer dependencies.
