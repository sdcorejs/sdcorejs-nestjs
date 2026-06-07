# Feature Folders Reorg (`src/features/` + single `/features` entry) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the 3 stateful modules into self-contained folders under `src/features/`, consolidate their public surface into a single `@sdcorejs/nestjs/features` entry point, and delete the central `src/entities/` + `SD_CORE_ENTITIES` — folded into the unpublished 1.0.0.

**Architecture:** Pure move/rename refactor, no behavior change. `action-history`, `job-scheduler`, `uploaded-file` each become a folder under `src/features/` holding their entity + service(s) + module + types; `src/features/index.ts` re-exports all three. The former per-feature sub-paths and `/entities` are replaced by one `/features` sub-path. Each task keeps build + tests + publint/attw green.

**Tech Stack:** TypeScript, NestJS 11, TypeORM, tsup (bundled dual ESM/CJS dts), Jest, publint/attw.

**Spec:** [docs/superpowers/specs/2026-06-07-feature-folders-reorg-design.md](../specs/2026-06-07-feature-folders-reorg-design.md)

**Branch:** `release/0.1.0` (do NOT switch). Builds on the prior central-entities reorg (which this partially reverses).

**Starting state:** `src/entities/` holds `action-history.entity.ts`, `job-scheduler.entity.ts`, `uploaded-file.entity.ts`, `index.ts`, `entities.spec.ts`. The 3 module dirs (`src/action-history/`, `src/job-scheduler/`, `src/uploaded-file/`) hold everything EXCEPT their entity (which currently lives in `src/entities/`). `package.json` exports + `typesVersions` + `tsup entryMap` list 16 entries including `./entities`, `./action-history`, `./job-scheduler`, `./uploaded-file`.

**Conventions for every task:** Bash for git/jest/tsc (Windows; absolute paths or `cd` inside one invocation). Typecheck: `npm run typecheck`. Tests: `npx jest`. Build+package: `npm run build && npm run check:exports`. Lint: `npm run lint` (`@typescript-eslint/no-unused-vars` is an ERROR). Full gate: add `npm run format:check` + `npm run test:coverage` + `npm pack --dry-run`.

---

### Task 1: Move the 3 modules under `src/features/`, consolidate to one `/features` entry

This is one atomic structural move — intermediate states do not build, so it lands as a single commit. Do the steps in order; only verify (Step 9) at the end.

**Files:**
- Move: `src/{action-history,job-scheduler,uploaded-file}/` → `src/features/…`; the 3 entity files from `src/entities/` → into their feature folders
- Delete: `src/entities/index.ts`, `src/entities/entities.spec.ts` (then the empty `src/entities/`)
- Create: `src/features/index.ts`
- Modify: each feature `index.ts`; broken relative imports; `package.json` (exports + typesVersions); `tsup.config.ts` (entryMap); tests importing the old sub-paths; `src/features/uploaded-file/public-api.spec.ts`

- [ ] **Step 1: Move the three module directories**

```bash
mkdir -p src/features
git mv src/action-history src/features/action-history
git mv src/job-scheduler src/features/job-scheduler
git mv src/uploaded-file src/features/uploaded-file
```

- [ ] **Step 2: Move each entity back into its feature folder, delete the central entities barrel**

```bash
git mv src/entities/action-history.entity.ts src/features/action-history/action-history.entity.ts
git mv src/entities/job-scheduler.entity.ts src/features/job-scheduler/job-scheduler.entity.ts
git mv src/entities/uploaded-file.entity.ts src/features/uploaded-file/uploaded-file.entity.ts
git rm src/entities/index.ts src/entities/entities.spec.ts
```
Confirm `src/entities/` is now empty/gone: `ls src/entities 2>/dev/null || echo gone`.

- [ ] **Step 3: Re-export the entity from each feature barrel**

Add the entity re-export as the FIRST line of each feature `index.ts`:
- `src/features/action-history/index.ts` → add `export * from './action-history.entity';`
- `src/features/job-scheduler/index.ts` → add `export * from './job-scheduler.entity';`
- `src/features/uploaded-file/index.ts` → add `export * from './uploaded-file.entity';`

- [ ] **Step 4: Create the `features` aggregator barrel**

Create `src/features/index.ts`:
```ts
export * from './action-history';
export * from './job-scheduler';
export * from './uploaded-file';
```

- [ ] **Step 5: Fix relative imports broken by the extra directory level**

Each feature moved one level deeper (`src/X/` → `src/features/X/`). Two classes of fixes:

1. **Entity import becomes local.** In the prior reorg, services/modules imported the entity from `'../entities/<x>.entity'`. Now it lives beside them:
```bash
git grep -nE "\.\./entities/(action-history|job-scheduler|uploaded-file)\.entity" -- src/features
```
For uploaded-file's services (in `services/`), the entity is one level up: `'../uploaded-file.entity'`. For the module + action-history/job-scheduler services (at the feature root), it is `'./<x>.entity'`. Fix each hit accordingly.

2. **Cross-module relative imports gain a `../`.** Find every relative import in the moved dirs that escapes the feature folder:
```bash
git grep -nE "from '(\.\./)+(orm|context|cache|http|jwt|audit|permission|tenancy|i18n|validation|queue|sd-core)" -- src/features
```
For each, add one `../` (e.g. `'../orm'` → `'../../orm'`, `'../orm/history'` → `'../../orm/history'`). Package imports (`@sdcorejs/utils`, `@nestjs/*`, `typeorm`) are unaffected. Within-feature imports (`./services/...`, `../types` from a service) are unaffected.

After fixing, run `npm run typecheck` — it must reach 0 errors before continuing (tsc pinpoints any missed path).

- [ ] **Step 6: Swap the entry points in config**

In `package.json` `exports`: remove the `"./action-history"`, `"./job-scheduler"`, `"./uploaded-file"`, and `"./entities"` blocks; add:
```json
"./features": {
  "import": { "types": "./dist/esm/features/index.d.mts", "default": "./dist/esm/features/index.mjs" },
  "require": { "types": "./dist/cjs/features/index.d.ts", "default": "./dist/cjs/features/index.cjs" }
}
```
In `package.json` `typesVersions["*"]`: remove `"action-history"`, `"job-scheduler"`, `"uploaded-file"`, `"entities"`; add `"features": ["./dist/cjs/features/index.d.ts"]`.
In `tsup.config.ts` `entryMap`: remove the `'action-history/index'`, `'job-scheduler/index'`, `'uploaded-file/index'`, `'entities/index'` lines; add `'features/index': 'src/features/index.ts',`.

- [ ] **Step 7: Swap test imports to the new entry**

```bash
git grep -nE "@sdcorejs/nestjs/(action-history|job-scheduler|uploaded-file|entities)" -- src test
```
Change every hit to `@sdcorejs/nestjs/features`. (Known: `test/integration/job-scheduler/job-scheduler.int-spec.ts` imports `JobScheduler` from `@sdcorejs/nestjs/entities` → `@sdcorejs/nestjs/features`.) The jest `moduleNameMapper` generic rule already resolves `@sdcorejs/nestjs/features` → `src/features/index.ts`; do NOT add a special mapping.

- [ ] **Step 8: Reverse the uploaded-file guard assertion**

In `src/features/uploaded-file/public-api.spec.ts`, the feature barrel now DOES export the entity. Replace the "does NOT export the entity" test with a positive one; keep the internal-helper-leak test:
```ts
import * as uploadedFile from './index';

describe('uploaded-file public API', () => {
  it('does NOT leak internal helpers', () => {
    const api = uploadedFile as Record<string, unknown>;
    for (const leaked of ['slugify', 'isBlank', 'toMb', 'addDays', 'distinct']) {
      expect(api[leaked]).toBeUndefined();
    }
  });

  it('exports the entity + module + service', () => {
    const api = uploadedFile as Record<string, unknown>;
    expect(api.UploadedFile).toBeDefined();
    expect(api.UploadedFileModule).toBeDefined();
    expect(api.UploadedFileService).toBeDefined();
  });
});
```

- [ ] **Step 9: Verify (full)**

Run: `npm run lint && npm run typecheck && npx jest && npm run build && npm run check:exports`
Expected: lint 0 errors; tsc 0; all tests pass; build OK; publint/attw **No problems found 🌟** with **13 entries** (root + 12 sub-paths), including `@sdcorejs/nestjs/features`, and NO `action-history`/`job-scheduler`/`uploaded-file`/`entities` sub-paths.
Also confirm the pack carries no stale dirs:
```bash
npm pack --dry-run 2>/dev/null | grep -cE "dist/(esm|cjs)/(entities|action-history|job-scheduler|uploaded-file)/"
```
Expected: `0`. And `dist/esm/features/index.d.mts` exists.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "refactor!: group stateful modules under src/features, single /features entry

BREAKING CHANGE: @sdcorejs/nestjs/{action-history,job-scheduler,uploaded-file,entities} are
replaced by a single @sdcorejs/nestjs/features barrel. SD_CORE_ENTITIES removed; entities live
inside their feature folder again. No behavior change."
```

---

### Task 2: Update docs

**Files:** `README.md`, `docs/migration-1.0.md`, `.changeset/core-1-0-0.md`, `docs/superpowers/specs/2026-06-07-1.0.0-api-audit-findings.md`

- [ ] **Step 1: README**

```bash
git grep -nE "@sdcorejs/nestjs/(action-history|job-scheduler|uploaded-file|entities)|SD_CORE_ENTITIES" -- README.md
```
In the Sub-paths section, remove the `action-history`, `job-scheduler`, `uploaded-file`, and `entities` rows (and any leftover `file-storage`) and add ONE row:
```md
| `@sdcorejs/nestjs/features` | Stateful feature modules — `ActionHistory`, `JobScheduler`, `UploadedFile` (entity + service + module each) |
```
Remove the `SD_CORE_ENTITIES` registration example. Update any usage snippet that imported from the old sub-paths to `@sdcorejs/nestjs/features` (e.g. `import { UploadedFileModule, UploadedFile } from '@sdcorejs/nestjs/features'`).

- [ ] **Step 2: migration-1.0.md**

Edit the "Directory reorg (1.0.0)" section: remove the `SD_CORE_ENTITIES`/central-entities line; add a row consolidating the entry points:
```md
| `@sdcorejs/nestjs/{file-storage,action-history,job-scheduler,uploaded-file}` and the interim `/entities` | all consolidated into a single `@sdcorejs/nestjs/features` |
```
Keep the table-rename migration (`file` → `uploaded_file`) and symbol-rename rows.

- [ ] **Step 3: changeset**

In `.changeset/core-1-0-0.md`, reword the reorg sentence (keep `major` frontmatter) to: "Feature modules (action-history, job-scheduler, uploaded-file) consolidated under a single `@sdcorejs/nestjs/features` entry (`src/features/`); entities live with their module; `FileEntity`→`UploadedFile`, table `file`→`uploaded_file`."

- [ ] **Step 4: audit-findings footnote**

In `docs/superpowers/specs/2026-06-07-1.0.0-api-audit-findings.md`, update the post-audit note to: "Post-audit: stateful modules grouped under `src/features/` and exposed via a single `@sdcorejs/nestjs/features` entry; the interim central `entities` entry + `SD_CORE_ENTITIES` were removed."

- [ ] **Step 5: Verify + commit**

```bash
git grep -nE "@sdcorejs/nestjs/(action-history|job-scheduler|uploaded-file|entities)\b|SD_CORE_ENTITIES" -- README.md
```
Expected: no stale references in README (the migration table's "from" column may name old paths — expected).
```bash
git add README.md docs/migration-1.0.md .changeset/core-1-0-0.md docs/superpowers/specs/2026-06-07-1.0.0-api-audit-findings.md
git commit -m "docs: consolidate feature sub-paths into /features; drop SD_CORE_ENTITIES refs"
```

---

### Task 3: Final verification gate + push

**Files:** none (verification)

- [ ] **Step 1: Run the full CI-equivalent gate**

```bash
npm run lint && npm run format:check && npm run typecheck && npm run test:coverage && npm run build && npm run check:exports && npm pack --dry-run
```
Expected: every step exits 0; publint/attw **No problems found**; pack ships only `dist/`, `README.md`, `LICENSE`, `CHANGELOG.md`. If `format:check` fails, run `npm run format` and commit as `style: prettier --write`.

- [ ] **Step 2: Confirm the published surface**

```bash
npm run build && ls dist/esm/features/index.d.mts dist/cjs/features/index.d.ts
npm pack --dry-run 2>/dev/null | grep -cE "dist/(esm|cjs)/(entities|action-history|job-scheduler|uploaded-file)/"
```
Expected: the two `features` type files exist; the grep count is `0` (no stale per-feature dirs).

- [ ] **Step 3: Push (no merge)**

```bash
git push origin release/0.1.0
```
Expected: branch updated on origin. Do NOT merge or open a PR — the user reviews on another machine.

---

## Notes on TDD scope

- Move/rename refactor with no behavior change → the existing 294+ test suite is the safety net and must stay green after Task 1. The updated `uploaded-file/public-api.spec.ts` locks the new invariant (feature barrel exports its entity; internal helpers stay private).
- Type correctness is enforced by `npm run typecheck`; package-resolution correctness by `npm run check:exports` (publint + attw) after the config swap.
