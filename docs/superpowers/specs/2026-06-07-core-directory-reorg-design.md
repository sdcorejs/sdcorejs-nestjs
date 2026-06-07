# Design — `@sdcorejs/nestjs` directory reorg (folded into 1.0.0)

**Date:** 2026-06-07
**Status:** Approved (design phase)
**Repo:** `sdcorejs-nestjs`, branch `release/0.1.0`
**Relation:** extends the 1.0.0 clean-break
([2026-06-07-core-1.0.0-standardization-release-design.md](./2026-06-07-core-1.0.0-standardization-release-design.md)).
This reorg is breaking; it ships **as part of 1.0.0** (branch not yet merged/published) so there is
a single breaking release rather than a 1.0 → 2.0 jump later.

## 1. Goal

The flat per-module layout makes entities and the file-storage module hard to distinguish. Reorg:
1. Collect all concrete entities into a canonical `src/entities/` with a `SD_CORE_ENTITIES` array and
   a new `@sdcorejs/nestjs/entities` entry point.
2. Rename the `file-storage` module to `uploaded-file` end-to-end (dir, entry point, entity, module,
   config, driver classes), with the `FileEntity` → `UploadedFile` entity and its table `file` →
   `uploaded_file`.
3. Group the busy `uploaded-file` module's services under `services/`.

## 2. Decisions (locked)

| Decision | Choice |
|---|---|
| Entity organization | Central `src/entities/` + `SD_CORE_ENTITIES` + new sub-path `@sdcorejs/nestjs/entities` |
| `file-storage` rename | Full rename to `uploaded-file` / `UploadedFile*` (dir, entry, entity, module, config, driver classes) |
| Entity table name | `@Entity('file')` → `@Entity('uploaded_file')` |
| Module entity re-export | Removed — entities are canonical only at `@sdcorejs/nestjs/entities` (no duplicate path) |
| Timing | Folded into the 1.0.0 release (same `release/0.1.0` branch) |
| `BaseEntity` | Stays in `orm/` (abstract base class, not a table; not part of `SD_CORE_ENTITIES`) |

## 3. Target structure

```
src/
  entities/                       (NEW)
    action-history.entity.ts      ActionHistory   @Entity('action-history')
    job-scheduler.entity.ts       JobScheduler    @Entity('job-scheduler')
    uploaded-file.entity.ts       UploadedFile    @Entity('uploaded_file')
    index.ts                      export * (3 entities) + SD_CORE_ENTITIES
  uploaded-file/                  (was file-storage/)
    services/
      aws.service.ts              AwsUploadedFileStorage
      local.service.ts            LocalUploadedFileStorage
      uploaded-file.service.ts    UploadedFileService
    uploaded-file.module.ts       UploadedFileModule
    types.ts
    utils.ts                      (internal helpers — slugify/isBlank/toMb/addDays)
    index.ts
    + *.spec.ts alongside their files
  action-history/                 service + module + types (entity moved to ../entities)
  job-scheduler/                  service + module + types (entity moved to ../entities)
  orm/base-entity.ts              BaseEntity (unchanged)
```

## 4. `src/entities/index.ts`

```ts
export * from './action-history.entity';
export * from './job-scheduler.entity';
export * from './uploaded-file.entity';

import { ActionHistory } from './action-history.entity';
import { JobScheduler } from './job-scheduler.entity';
import { UploadedFile } from './uploaded-file.entity';

/**
 * Every concrete TypeORM entity shipped by `@sdcorejs/nestjs`. Spread into your DataSource's
 * `entities` array to register all library tables at once.
 */
export const SD_CORE_ENTITIES = [ActionHistory, JobScheduler, UploadedFile] as const;
```

## 5. Full rename map (`uploaded-file` module)

| Old | New |
|---|---|
| dir `src/file-storage/` | `src/uploaded-file/` |
| entry `@sdcorejs/nestjs/file-storage` | `@sdcorejs/nestjs/uploaded-file` |
| `FileEntity` (`file.entity.ts`, `@Entity('file')`) | `UploadedFile` (`entities/uploaded-file.entity.ts`, `@Entity('uploaded_file')`) |
| `FileStorageModule` (`file-storage.module.ts`) | `UploadedFileModule` (`uploaded-file.module.ts`) |
| `FileStorageConfig` | `UploadedFileConfig` |
| `FILE_STORAGE_CONFIG` | `UPLOADED_FILE_CONFIG` |
| `IFileStorageService` (interface + token) | `IUploadedFileStorage` |
| `AwsFileStorageService` | `AwsUploadedFileStorage` |
| `LocalFileStorageService` | `LocalUploadedFileStorage` |
| `FileUploadMeta` | `UploadedFileMeta` |
| `UploadResult` | `UploadedFileResult` |
| `UploadedFileService` | unchanged |

The entity moves to `src/entities/`; the `uploaded-file` module imports `UploadedFile` from
`../entities`. Service files keep their short filenames (`aws.service.ts`, `local.service.ts`,
`uploaded-file.service.ts`) but move under `services/`.

## 6. Entity de-duplication

Per the same single-canonical-path principle applied in the 1.0.0 audit, module barrels stop
re-exporting their entity:
- `action-history/index.ts` — drop `export * from './action-history.entity'`
- `job-scheduler/index.ts` — drop `export * from './job-scheduler.entity'`
- `uploaded-file/index.ts` — does not export the entity

Each module imports its entity internally from `../entities`. The only public path to an entity is
`@sdcorejs/nestjs/entities`.

## 7. 1.0.0 integration

- **`package.json`** `exports` + `typesVersions`: remove `./file-storage`, add `./uploaded-file` and
  `./entities`. Net **16 entries** (15 sub-paths + root). Keep the per-format `.d.mts`/`.d.ts`
  nested-condition shape from the dual-types fix.
- **`tsup.config.ts`** `entryMap`: remove `file-storage/index`, add `uploaded-file/index` +
  `entities/index`.
- **jest** `moduleNameMapper` is generic (`@sdcorejs/nestjs/(.*)` → `src/$1/index.ts`) — no change;
  `@sdcorejs/nestjs/entities` resolves automatically.
- **Guard tests:** move `file-storage/public-api.spec.ts` → `uploaded-file/public-api.spec.ts`
  (assert leaked helpers still absent under the new path); add a small `entities` sanity test
  (`SD_CORE_ENTITIES` has 3 members; `UploadedFile` is defined).
- **Docs:** README (swap file-storage→uploaded-file sub-path + usage, add `entities` sub-path with
  `SD_CORE_ENTITIES` example), `docs/migration-1.0.md` (rename map + table `file`→`uploaded_file`),
  the 1.0.0 changeset description, and the audit-findings doc footnote.

## 8. Verification

Same gate as 1.0.0: `lint` · `typecheck` · `test:coverage` · `build` (tsup bundled dts) ·
`check:exports` (publint + attw — all 16 sub-paths must stay green) · `pack --dry-run`. Entry-set
parity re-checked (exports ↔ typesVersions ↔ tsup entryMap, now 16).

## 9. Consumer impact / out of scope

- **DB migration:** renaming the table `file` → `uploaded_file` requires a rename migration in
  `enterprise-platform` when it adopts 1.0.0. Documented in `docs/migration-1.0.md`; **not** performed
  here.
- **enterprise-platform import swaps** (`/file-storage` → `/uploaded-file`, `FileEntity` →
  `UploadedFile`, register `SD_CORE_ENTITIES`): separate task — it consumes the lib as a vendored
  tarball and upgrades on its own schedule.
- No behavior changes: storage drivers, upload/download logic, and the `UploadedFileService` API are
  byte-for-byte the same; only names and locations move.

## 10. Acceptance criteria

1. All 3 concrete entities live in `src/entities/`; `SD_CORE_ENTITIES` exports them; `@sdcorejs/nestjs/entities` resolves.
2. `file-storage` is gone; `uploaded-file` exists with the full rename map applied and services under `services/`.
3. `UploadedFile` entity uses `@Entity('uploaded_file')`.
4. No module barrel re-exports an entity; the only entity path is `@sdcorejs/nestjs/entities`.
5. `exports`/`typesVersions`/`tsup entryMap` agree on 16 entries; publint + attw green.
6. Full gate green; all tests pass (guard tests updated).
7. README, migration-1.0, changeset, and audit-findings reflect the new names/paths.
