# Migrating to @sdcorejs/nestjs 1.0.0

1.0.0 finalizes the public API. Breaking changes from 0.1.x:

| Removed | Use instead |
|---|---|
| `SdFilter` / `SdFilterOperator` / `SdOrder` / `SdPagingReq` / `SdPagingRes` (`/orm`) | `Filter` / `Operator` / `Order` / `PagingReq` / `PagingRes` from `@sdcorejs/utils/models` |
| `Scoped` / `TenantScoped` / `getScopedColumns` from `/tenancy` | the same symbols from `@sdcorejs/nestjs/orm` |
| `ValidationUtilities` / `ArrayUtilities` / `StringUtilities` / `Utilities` from `/orm` | `@sdcorejs/utils/fns` |
| `slugify` / `isBlank` / `toMb` / `addDays` / `distinct` from `/file-storage` | internal helpers; use `@sdcorejs/utils` (`ArrayUtilities.distinct`) |
| internal metadata keys + accessors leaked from `/orm`, `/context`, `/cache`, `/validation`, `/i18n` | not public — see `docs/superpowers/specs/2026-06-07-1.0.0-api-audit-findings.md` |
| `propertyOf` (was internal `src/utils`) | `NestedKeyOf<T>` from `@sdcorejs/utils/models` |

## Module resolution

Types are now resolved through the package `exports` map's per-format conditions
(`.d.mts` for ESM, `.d.ts` for CJS). Do not deep-import into `dist/`. Always import
from the documented sub-paths, e.g. `@sdcorejs/nestjs/orm`.

## Directory reorg (1.0.0)

| Change | Action |
|---|---|
| `@sdcorejs/nestjs/file-storage` → `/uploaded-file` | update import paths |
| `FileEntity` → `UploadedFile` (now at `@sdcorejs/nestjs/entities`) | update imports |
| `FileStorageModule` → `UploadedFileModule` | update bootstrap |
| `FileStorageConfig`/`IFileStorageService`/`AwsFileStorageService`/`LocalFileStorageService`/`FILE_STORAGE_CONFIG`/`FileUploadMeta`/`UploadResult` | renamed to `UploadedFile*` / `IUploadedFileStorage` / `UPLOADED_FILE_CONFIG` |
| Entities no longer re-exported from their module barrels | import from `@sdcorejs/nestjs/entities` (or spread `SD_CORE_ENTITIES`) |
| **DB:** table `file` → `uploaded_file` | add a rename migration: `ALTER TABLE "file" RENAME TO "uploaded_file";` |
