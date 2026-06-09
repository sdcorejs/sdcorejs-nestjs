# Directory Reorg (entities/ + uploaded-file) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collect all concrete entities into `src/entities/` (with `SD_CORE_ENTITIES` + a `@sdcorejs/nestjs/entities` entry point) and rename the `file-storage` module to `uploaded-file` end-to-end — folded into the 1.0.0 release.

**Architecture:** Pure move/rename refactor — no behavior change. Entities become canonical only at `@sdcorejs/nestjs/entities`; module barrels stop re-exporting them. The `file-storage` module is renamed to `uploaded-file` (dir, entry point, entity, module, config, driver classes) with the entity table `file` → `uploaded_file`. Each task keeps the build + tests + publint/attw green.

**Tech Stack:** TypeScript, NestJS 11, TypeORM, tsup (bundled dual ESM/CJS dts), Jest, publint/attw.

**Spec:** [docs/superpowers/specs/2026-06-07-core-directory-reorg-design.md](../specs/2026-06-07-core-directory-reorg-design.md)

**Branch:** `release/0.1.0` (do NOT switch). This reorg ships inside the unpublished 1.0.0.

**Conventions for every task:** Bash for git/jest/tsc (Windows; absolute paths or `cd` inside one invocation). Typecheck: `npm run typecheck`. Tests: `npx jest`. Build + package check: `npm run build && npm run check:exports`. Lint (`@typescript-eslint/no-unused-vars` is an ERROR): `npm run lint`.

---

### Task 1: Create `src/entities/` and move `ActionHistory` + `JobScheduler`

**Files:**
- Create: `src/entities/action-history.entity.ts` (moved), `src/entities/job-scheduler.entity.ts` (moved), `src/entities/index.ts`
- Modify: `src/action-history/index.ts`, `src/job-scheduler/index.ts`, and every importer of the two entities
- Modify: `package.json` (exports + typesVersions), `tsup.config.ts` (entryMap)

- [ ] **Step 1: Move the two entity files (preserve history)**

```bash
git mv src/action-history/action-history.entity.ts src/entities/action-history.entity.ts
git mv src/job-scheduler/job-scheduler.entity.ts src/entities/job-scheduler.entity.ts
```
Do NOT change the entity classes or their `@Entity('action-history')` / `@Entity('job-scheduler')` table names.

- [ ] **Step 2: Find and repoint internal importers**

```bash
git grep -nE "action-history\.entity|job-scheduler\.entity" -- src
```
For each hit (services, modules with `TypeOrmModule.forFeature`, specs), change the import path to the new location, e.g. inside `src/action-history/`: `'./action-history.entity'` → `'../entities/action-history.entity'`. Re-run the grep — expect zero references to the old in-module paths.

- [ ] **Step 3: Drop the entity re-export from the two module barrels**

In `src/action-history/index.ts` delete the line `export * from './action-history.entity';`.
In `src/job-scheduler/index.ts` delete the line `export * from './job-scheduler.entity';`.
(The entities become canonical at `@sdcorejs/nestjs/entities` — created next.)

- [ ] **Step 4: Create the entities barrel**

Create `src/entities/index.ts`:
```ts
export * from './action-history.entity';
export * from './job-scheduler.entity';

import { ActionHistory } from './action-history.entity';
import { JobScheduler } from './job-scheduler.entity';

/**
 * Every concrete TypeORM entity shipped by `@sdcorejs/nestjs`. Spread into your DataSource's
 * `entities` array to register all library tables at once.
 */
export const SD_CORE_ENTITIES = [ActionHistory, JobScheduler] as const;
```
(`UploadedFile` is added to both the re-export and the array in Task 2.)

- [ ] **Step 5: Register the `entities` entry point**

In `package.json`, add an `"./entities"` key to `exports` mirroring the shape of an existing entry (e.g. `"./orm"`):
```json
"./entities": {
  "import": { "types": "./dist/esm/entities/index.d.mts", "default": "./dist/esm/entities/index.mjs" },
  "require": { "types": "./dist/cjs/entities/index.d.ts", "default": "./dist/cjs/entities/index.cjs" }
}
```
In `package.json` `typesVersions["*"]`, add: `"entities": ["./dist/cjs/entities/index.d.ts"]`.
In `tsup.config.ts` `entryMap`, add: `'entities/index': 'src/entities/index.ts',`.

- [ ] **Step 6: Verify**

Run: `npm run typecheck && npx jest && npm run build && npm run check:exports`
Expected: tsc exit 0; all tests pass; build succeeds; publint/attw report **No problems found** (now 16 sub-paths). If a test imported `ActionHistory`/`JobScheduler` from the module barrel, repoint it to `@sdcorejs/nestjs/entities` or the relative `../entities`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor!: move ActionHistory + JobScheduler to src/entities, add /entities entry

BREAKING CHANGE: entities are canonical at @sdcorejs/nestjs/entities (SD_CORE_ENTITIES);
no longer re-exported from /action-history or /job-scheduler."
```

---

### Task 2: Rename `file-storage` → `uploaded-file` (full rename + entity to `src/entities/`)

**Files:**
- Rename dir `src/file-storage/` → `src/uploaded-file/`; move services under `src/uploaded-file/services/`
- Move + rename `file.entity.ts` → `src/entities/uploaded-file.entity.ts`
- Modify: `src/entities/index.ts`, `src/uploaded-file/index.ts`, all module files, `package.json`, `tsup.config.ts`

**Full rename map (apply everywhere — classes, tokens, types, the entry path):**

| Old | New |
|---|---|
| `FileEntity` (`@Entity('file')`) | `UploadedFile` (`@Entity('uploaded_file')`) |
| `FileStorageModule` | `UploadedFileModule` |
| `FileStorageConfig` | `UploadedFileConfig` |
| `FILE_STORAGE_CONFIG` | `UPLOADED_FILE_CONFIG` |
| `IFileStorageService` (interface + token) | `IUploadedFileStorage` |
| `AwsFileStorageService` | `AwsUploadedFileStorage` |
| `LocalFileStorageService` | `LocalUploadedFileStorage` |
| `FileUploadMeta` | `UploadedFileMeta` |
| `UploadResult` | `UploadedFileResult` |
| `UploadedFileService` | unchanged |
| entry `@sdcorejs/nestjs/file-storage` | `@sdcorejs/nestjs/uploaded-file` |

- [ ] **Step 1: Move the entity into `src/entities/` and rename it**

```bash
git mv src/file-storage/file.entity.ts src/entities/uploaded-file.entity.ts
```
In `src/entities/uploaded-file.entity.ts`: rename `class FileEntity` → `class UploadedFile`, change `@Entity('file')` → `@Entity('uploaded_file')`, and update the doc-comment ("Table `file`" → "Table `uploaded_file`"). Leave all columns unchanged.

- [ ] **Step 2: Rename the module directory and group services**

```bash
git mv src/file-storage src/uploaded-file
git mv src/uploaded-file/file-storage.module.ts src/uploaded-file/uploaded-file.module.ts
mkdir -p src/uploaded-file/services
git mv src/uploaded-file/aws.service.ts src/uploaded-file/services/aws.service.ts
git mv src/uploaded-file/local.service.ts src/uploaded-file/services/local.service.ts
git mv src/uploaded-file/uploaded-file.service.ts src/uploaded-file/services/uploaded-file.service.ts
git mv src/uploaded-file/file.service.spec.ts src/uploaded-file/services/file.service.spec.ts
git mv src/uploaded-file/local.service.spec.ts src/uploaded-file/services/local.service.spec.ts
```
The two service spec files (`file.service.spec.ts`, `local.service.spec.ts`) move into `services/` beside their subjects. Keep `utils.spec.ts` and `public-api.spec.ts` at the module root (`utils.ts` stays at root; `public-api.spec.ts` is handled in Task 3). Run `git status` to confirm what moved.

- [ ] **Step 3: Apply the full rename map across the module**

In every file under `src/uploaded-file/` and `src/entities/uploaded-file.entity.ts`, apply the rename map (class names, the `FILE_STORAGE_CONFIG`/`IFileStorageService` symbols, type names). Fix all relative imports broken by the moves:
- `uploaded-file.module.ts` imports services from `./services/...` and `UploadedFile` from `../entities/uploaded-file.entity`; `TypeOrmModule.forFeature([UploadedFile])`; `module: UploadedFileModule`.
- `services/*.service.ts` import `UploadedFile` from `../../entities/uploaded-file.entity`, and `types` from `../types`.
- `types.ts` exports `UploadedFileConfig`, `UPLOADED_FILE_CONFIG`, `UploadedFileResult`, `UploadedFileMeta`, `IUploadedFileStorage` (+ token).

- [ ] **Step 4: Rewrite `src/uploaded-file/index.ts`**

It must export the module + services + types but **NOT** the entity (canonical at `/entities`). Mirror the prior `file-storage/index.ts` minus the entity line and minus `./utils` (utils stays internal):
```ts
export * from './types';
export * from './services/uploaded-file.service';
export * from './services/aws.service';
export * from './services/local.service';
export * from './uploaded-file.module';
```

- [ ] **Step 5: Complete the entities barrel**

In `src/entities/index.ts` add `UploadedFile`:
```ts
export * from './action-history.entity';
export * from './job-scheduler.entity';
export * from './uploaded-file.entity';

import { ActionHistory } from './action-history.entity';
import { JobScheduler } from './job-scheduler.entity';
import { UploadedFile } from './uploaded-file.entity';

export const SD_CORE_ENTITIES = [ActionHistory, JobScheduler, UploadedFile] as const;
```

- [ ] **Step 6: Swap the entry point in config**

In `package.json` `exports`: remove the `"./file-storage"` block, add `"./uploaded-file"`:
```json
"./uploaded-file": {
  "import": { "types": "./dist/esm/uploaded-file/index.d.mts", "default": "./dist/esm/uploaded-file/index.mjs" },
  "require": { "types": "./dist/cjs/uploaded-file/index.d.ts", "default": "./dist/cjs/uploaded-file/index.cjs" }
}
```
In `typesVersions["*"]`: remove `"file-storage"`, add `"uploaded-file": ["./dist/cjs/uploaded-file/index.d.ts"]`.
In `tsup.config.ts` `entryMap`: replace `'file-storage/index': 'src/file-storage/index.ts'` with `'uploaded-file/index': 'src/uploaded-file/index.ts'`.

- [ ] **Step 7: Catch stragglers**

```bash
git grep -nE "file-storage|FileStorage|FILE_STORAGE|FileEntity|IFileStorageService|FileUploadMeta|UploadResult" -- src
```
Expected: zero hits in `src/` except inside `docs`. Fix any remaining reference per the rename map. (Docs are handled in Task 4.)

- [ ] **Step 8: Verify**

Run: `npm run lint && npm run typecheck && npx jest && npm run build && npm run check:exports`
Expected: lint 0 errors; tsc 0; all tests pass; build OK; publint/attw **No problems found** (16 sub-paths, now including `uploaded-file` + `entities`, no `file-storage`).

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor!: rename file-storage module to uploaded-file; entity to UploadedFile

BREAKING CHANGE: @sdcorejs/nestjs/file-storage -> /uploaded-file. FileEntity -> UploadedFile
(now in @sdcorejs/nestjs/entities), table file -> uploaded_file. FileStorageModule ->
UploadedFileModule; FileStorageConfig/IFileStorageService/Aws|LocalFileStorageService and
related types renamed to UploadedFile*. Consumers must add a table-rename migration."
```

---

### Task 3: Update guard tests + verify entry-set parity

**Files:**
- Move/rewrite: `src/uploaded-file/public-api.spec.ts` (was `file-storage/public-api.spec.ts`)
- Create: `src/entities/entities.spec.ts`

- [ ] **Step 1: Repoint the uploaded-file guard test**

`file-storage/public-api.spec.ts` moved with the dir in Task 2. Open `src/uploaded-file/public-api.spec.ts` and update it to import from `./index` and assert the internal helpers are still NOT leaked, and that the entity is NOT exported from the module barrel:
```ts
import * as uploadedFile from './index';

describe('uploaded-file public API', () => {
  it('does NOT leak internal helpers', () => {
    const api = uploadedFile as Record<string, unknown>;
    for (const leaked of ['slugify', 'isBlank', 'toMb', 'addDays', 'distinct']) {
      expect(api[leaked]).toBeUndefined();
    }
  });

  it('does NOT export the entity (canonical at @sdcorejs/nestjs/entities)', () => {
    expect((uploadedFile as Record<string, unknown>).UploadedFile).toBeUndefined();
  });

  it('exports the module + service', () => {
    const api = uploadedFile as Record<string, unknown>;
    expect(api.UploadedFileModule).toBeDefined();
    expect(api.UploadedFileService).toBeDefined();
  });
});
```

- [ ] **Step 2: Add the entities sanity test**

Create `src/entities/entities.spec.ts`:
```ts
import { SD_CORE_ENTITIES, ActionHistory, JobScheduler, UploadedFile } from './index';

describe('entities barrel', () => {
  it('SD_CORE_ENTITIES lists the three concrete entities', () => {
    expect(SD_CORE_ENTITIES).toEqual([ActionHistory, JobScheduler, UploadedFile]);
  });

  it('UploadedFile is the renamed entity', () => {
    expect(UploadedFile.name).toBe('UploadedFile');
  });
});
```

- [ ] **Step 3: Verify tests**

Run: `npx jest src/uploaded-file/public-api.spec.ts src/entities/entities.spec.ts`
Expected: both pass.

- [ ] **Step 4: Verify entry-set parity (16 entries)**

Run:
```bash
node -e "const p=require('./package.json');const ex=Object.keys(p.exports).filter(k=>k!=='.').map(k=>k.slice(2)).sort();const tv=Object.keys(p.typesVersions['*']).sort();console.log('exports',ex.length,'typesVersions',tv.length,JSON.stringify(ex)===JSON.stringify(tv)?'MATCH':'MISMATCH');console.log('has uploaded-file:',ex.includes('uploaded-file'),'| has entities:',ex.includes('entities'),'| has file-storage:',ex.includes('file-storage'));"
```
Expected: exports 15, typesVersions 15, MATCH; `uploaded-file` true, `entities` true, `file-storage` **false**. Also confirm `tsup.config.ts` `entryMap` has `uploaded-file/index` + `entities/index` and no `file-storage/index`:
```bash
git grep -nE "uploaded-file/index|entities/index|file-storage/index" -- tsup.config.ts
```

- [ ] **Step 5: Full gate**

Run: `npm run lint && npm run typecheck && npm run test:coverage && npm run build && npm run check:exports && npm pack --dry-run`
Expected: all green; publint/attw **No problems found**.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "test: update guard tests for uploaded-file + entities; verify 16-entry parity"
```

---

### Task 4: Update docs to the new names/paths

**Files:**
- Modify: `README.md`, `docs/migration-1.0.md`, `.changeset/core-1-0-0.md`, `docs/superpowers/specs/2026-06-07-1.0.0-api-audit-findings.md`

- [ ] **Step 1: README**

```bash
git grep -nE "file-storage|FileEntity|FileStorage" -- README.md
```
For each hit: change the sub-path `@sdcorejs/nestjs/file-storage` → `/uploaded-file`, `FileEntity` → `UploadedFile`, `FileStorageModule` → `UploadedFileModule`. In the Sub-paths section, rename the `file-storage` row to `uploaded-file` and ADD an `entities` row: "All shipped TypeORM entities + `SD_CORE_ENTITIES`". Add a short registration example:
```md
import { SD_CORE_ENTITIES } from '@sdcorejs/nestjs/entities';
TypeOrmModule.forRoot({ entities: [...SD_CORE_ENTITIES, /* your entities */] })
```

- [ ] **Step 2: migration-1.0.md**

Append a "Directory reorg (1.0.0)" section to `docs/migration-1.0.md`:
```md
## Directory reorg (1.0.0)

| Change | Action |
|---|---|
| `@sdcorejs/nestjs/file-storage` → `/uploaded-file` | update import paths |
| `FileEntity` → `UploadedFile` (now at `@sdcorejs/nestjs/entities`) | update imports |
| `FileStorageModule` → `UploadedFileModule` | update bootstrap |
| `FileStorageConfig`/`IFileStorageService`/`AwsFileStorageService`/`LocalFileStorageService`/`FILE_STORAGE_CONFIG`/`FileUploadMeta`/`UploadResult` | renamed to `UploadedFile*` / `IUploadedFileStorage` / `UPLOADED_FILE_CONFIG` |
| Entities no longer re-exported from their module barrels | import from `@sdcorejs/nestjs/entities` (or spread `SD_CORE_ENTITIES`) |
| **DB:** table `file` → `uploaded_file` | add a rename migration: `ALTER TABLE "file" RENAME TO "uploaded_file";` |
```

- [ ] **Step 3: changeset**

In `.changeset/core-1-0-0.md`, append a sentence to the body: "Reorganized entities into `@sdcorejs/nestjs/entities` (`SD_CORE_ENTITIES`) and renamed the `file-storage` module to `uploaded-file` (`FileEntity`→`UploadedFile`, table `file`→`uploaded_file`)." Keep the `major` frontmatter.

- [ ] **Step 4: audit-findings footnote**

In `docs/superpowers/specs/2026-06-07-1.0.0-api-audit-findings.md`, add a one-line note that file-storage was renamed to uploaded-file and entities centralized post-audit.

- [ ] **Step 5: Verify + commit**

```bash
git grep -nE "@sdcorejs/nestjs/file-storage|FileEntity\b" -- README.md docs
```
Expected: no stale references (the migration table intentionally mentions the OLD names as the "from" column — that's fine).
```bash
git add README.md docs/migration-1.0.md .changeset/core-1-0-0.md docs/superpowers/specs/2026-06-07-1.0.0-api-audit-findings.md
git commit -m "docs: reflect entities/ + uploaded-file rename in README, migration, changeset"
```

---

### Task 5: Final verification gate + push

**Files:** none (verification)

- [ ] **Step 1: Run the full CI-equivalent gate**

```bash
npm run lint && npm run format:check && npm run typecheck && npm run test:coverage && npm run build && npm run check:exports && npm pack --dry-run
```
Expected: every step exits 0. publint/attw **No problems found**. `npm pack --dry-run` ships only `dist/`, `README.md`, `LICENSE`, `CHANGELOG.md`. If `format:check` fails, run `npm run format` and commit as `style: prettier --write`.

- [ ] **Step 2: Confirm the published surface includes the new entry points**

```bash
npm run build && ls dist/esm/entities/index.d.mts dist/cjs/entities/index.d.ts dist/esm/uploaded-file/index.d.mts dist/cjs/uploaded-file/index.d.ts
```
Expected: all four type files exist; no `dist/*/file-storage/` directory.

- [ ] **Step 3: Push**

```bash
git push origin release/0.1.0
```
Expected: branch updated on origin. (PR creation/merge is the user's manual step — `gh` is not authenticated in this environment.)

---

## Notes on TDD scope

- This is a move/rename refactor with no behavior change, so the existing test suite is the primary safety net — it must stay green after every task. The new specs (`uploaded-file/public-api.spec.ts`, `entities/entities.spec.ts`) lock the public-surface invariants (entity not leaked from module barrel; `SD_CORE_ENTITIES` complete).
- Type-level correctness is verified by `npm run typecheck`; package-resolution correctness by `npm run check:exports` (publint + attw) after every config change.
