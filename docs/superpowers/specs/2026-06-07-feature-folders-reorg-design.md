# Design — Feature folders under `src/features/` (folded into 1.0.0)

**Date:** 2026-06-07
**Status:** Approved (design phase)
**Repo:** `sdcorejs-nestjs`, branch `release/0.1.0`
**Supersedes:** the central-entities decision in
[2026-06-07-core-directory-reorg-design.md](./2026-06-07-core-directory-reorg-design.md). That reorg
moved entities into a central `src/entities/` with `SD_CORE_ENTITIES`. This spec replaces that with
self-contained feature folders under `src/features/` and **drops** `src/entities/` +
`SD_CORE_ENTITIES`. Ships inside the unpublished 1.0.0 (single breaking release).

## 1. Goal

Make each stateful/data module a self-contained folder holding all its existing layers, grouped
under a `src/features/` parent — instead of scattering entities into a central folder. Improves
feature cohesion and makes the tree easy to scan.

## 2. Decisions (locked)

| Decision | Choice |
|---|---|
| Layer scope | **Reorganize existing files only** — no new `*.controller.ts` (lib stays neutral, no HTTP routes) and no new `*.repository.ts` (services keep `@InjectRepository(Entity)`) |
| Which modules | Only the **3 data modules**: `action-history`, `job-scheduler`, `uploaded-file` (they own entities/tables). The 11 cross-cutting infra modules stay at `src/` top-level |
| Parent folder name | `features` |
| Entity location | Back **inside** each feature folder (canonical at the feature barrel) |
| `SD_CORE_ENTITIES` + `@sdcorejs/nestjs/entities` | **Dropped** — consumers register entities individually from their feature sub-path |
| Timing | Folded into 1.0.0 (`release/0.1.0`, not yet merged/published) |
| `BaseEntity` / `orm` | Unchanged (infra; stays in `src/orm/`) |

## 3. Target structure

```
src/
  features/
    action-history/
      action-history.entity.ts        ActionHistory   @Entity('action-history')
      action-history.service.ts
      action-history.module.ts
      types.ts
      index.ts
      action-history.service.spec.ts
    job-scheduler/
      job-scheduler.entity.ts          JobScheduler    @Entity('job-scheduler')
      job-scheduler.service.ts
      job-scheduler.module.ts
      types.ts
      index.ts
      job-scheduler.service.spec.ts
    uploaded-file/
      uploaded-file.entity.ts          UploadedFile    @Entity('uploaded_file')
      services/
        aws.service.ts                 AwsUploadedFileStorage
        local.service.ts               LocalUploadedFileStorage
        uploaded-file.service.ts       UploadedFileService
        file.service.spec.ts · local.service.spec.ts
      uploaded-file.module.ts          UploadedFileModule
      types.ts · utils.ts · index.ts
      utils.spec.ts · public-api.spec.ts
  orm/ context/ cache/ http/ jwt/ audit/ permission/ tenancy/ i18n/ validation/ queue/
  index.ts · sd-core.module.ts · sd-core.types.ts
```
`src/entities/` is deleted.

## 4. Moves / deletions

- Delete `src/entities/index.ts` and `src/entities/entities.spec.ts`.
- `git mv` each entity back into its feature folder:
  - `src/entities/action-history.entity.ts` → `src/features/action-history/action-history.entity.ts`
  - `src/entities/job-scheduler.entity.ts` → `src/features/job-scheduler/job-scheduler.entity.ts`
  - `src/entities/uploaded-file.entity.ts` → `src/features/uploaded-file/uploaded-file.entity.ts`
- `git mv` the three module directories under `features/`:
  - `src/action-history/` → `src/features/action-history/`
  - `src/job-scheduler/` → `src/features/job-scheduler/`
  - `src/uploaded-file/` → `src/features/uploaded-file/`

## 5. Barrels + entity re-export

Each feature `index.ts` re-exports its own entity again (reversing the earlier de-dup, since there
is no central entity path now):
- `features/action-history/index.ts`: `export * from './action-history.entity'` + service + module + types
- `features/job-scheduler/index.ts`: `export * from './job-scheduler.entity'` + service + module + types
- `features/uploaded-file/index.ts`: `export * from './uploaded-file.entity'` + types + services + module
  (still NOT exporting `./utils` — utils stay internal)

## 6. Entry points + build config

- **Sub-path names unchanged**: `@sdcorejs/nestjs/action-history`, `/job-scheduler`, `/uploaded-file` keep resolving.
- `tsup.config.ts` `entryMap`: change only the source **value** for the three (`'action-history/index': 'src/features/action-history/index.ts'`, etc.); keep the **key** so the output dir (`dist/*/action-history/`) and the `exports`/`typesVersions` entries are unchanged. Remove the `'entities/index'` entry.
- `package.json`: remove `"./entities"` from `exports` and `"entities"` from `typesVersions`. The three feature sub-paths are unchanged. Back to **15 entries**.
- `jest.config.cjs` `moduleNameMapper`: add specific mappings **before** the generic `^@sdcorejs/nestjs/(.*)$` rule so the moved features resolve:
  ```js
  '^@sdcorejs/nestjs/(action-history|job-scheduler|uploaded-file)$': '<rootDir>/src/features/$1/index.ts',
  '^@sdcorejs/nestjs/(action-history|job-scheduler|uploaded-file)/(.*)$': '<rootDir>/src/features/$1/$2',
  ```

## 7. Relative-import fixups

Moving `src/X/` → `src/features/X/` adds one directory level, so every relative cross-module import
gains a `../` (e.g. a service importing `'../orm'` → `'../../orm'`, `'@sdcorejs/utils'` package
imports are unaffected). The entity import inside each feature becomes local again
(`'../entities/x.entity'` → `'./x.entity'`). Find with `git grep` after the moves; `tsc` + the test
suite catch any miss.

## 8. Guard tests

- Delete `src/entities/entities.spec.ts`.
- `features/uploaded-file/public-api.spec.ts`: **reverse** the entity assertion — now assert the
  feature barrel **does** export `UploadedFile`; keep the "no leaked internal helpers"
  (`slugify`/`isBlank`/`toMb`/`addDays`/`distinct` undefined) and the module/service-exported checks.

## 9. 1.0.0 doc updates

- **README**: remove the `entities` sub-path row + the `SD_CORE_ENTITIES` registration example; the
  `uploaded-file` sub-path now documents `UploadedFile` as importable from it. (Sub-path names are
  unchanged; the `src/features/` location is internal.)
- **`docs/migration-1.0.md`**: drop the central-entities / `SD_CORE_ENTITIES` lines. Entity imports
  are from their feature sub-path (`@sdcorejs/nestjs/uploaded-file` exports `UploadedFile`, etc.).
  Keep the table-rename migration (`file` → `uploaded_file`) and the symbol-rename rows.
- **`.changeset/core-1-0-0.md`**: reword the reorg sentence to "feature modules grouped under
  `src/features/`; entities live with their module" (no `SD_CORE_ENTITIES`).
- **audit-findings footnote**: update to mention the `src/features/` layout.

## 10. Verification

Full gate unchanged: `lint` · `format:check` · `typecheck` · `test:coverage` · `build` (clean,
bundled dts) · `check:exports` (publint + attw — now **15** sub-paths, all green) · `pack
--dry-run`. Re-check entry-set parity (exports ↔ typesVersions ↔ tsup keys = 15) and confirm no
`entities` sub-path remains and no stale `dist/*/entities/` ships.

## 11. Out of scope

- No new controllers or repository classes (decided: reorganize only).
- enterprise-platform import swaps + the `file` → `uploaded_file` table migration (separate task;
  vendored consumer upgrades on its own schedule).
- No behavior changes — only file locations, barrels, and the dropped `entities` aggregator.

## 12. Acceptance criteria

1. `src/features/{action-history,job-scheduler,uploaded-file}/` each contain their entity + service + module + types (+ uploaded-file's services/ + utils); `src/entities/` is gone.
2. Each feature barrel re-exports its entity; `@sdcorejs/nestjs/<feature>` resolves and exports the entity.
3. `@sdcorejs/nestjs/entities` and `SD_CORE_ENTITIES` no longer exist anywhere.
4. `exports`/`typesVersions`/`tsup entryMap` agree on 15 entries; publint + attw green; no `entities` artifact in the pack.
5. Full gate green; all tests pass (guard tests updated).
6. README/migration/changeset/audit-findings reflect the `src/features/` layout and the removal of `SD_CORE_ENTITIES`.
