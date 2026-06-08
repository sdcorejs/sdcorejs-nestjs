# Design — README refresh + VitePress showcase site + GitHub Pages deploy

**Date:** 2026-06-08
**Repo:** `@sdcorejs/nestjs` (`sdcorejs-nestjs`)
**Branch:** `release/0.1.0` (existing — bundle with the 1.0.0 release)
**Status:** Design approved → implementation plan next.

---

## Goal

Ship a public-facing showcase for `@sdcorejs/nestjs` that documents every shipped feature with
copy-paste usage samples, and refresh the package `README.md` to cover the features added in the
last 5 commits. The showcase is a static VitePress site living in the lib repo under `site/`,
built and deployed to GitHub Pages by a GitHub Action on push to `main`.

The library is server-side (NestJS + TypeORM); it cannot run in a browser. The "showcase" is
therefore a **documentation site with highlighted, copy-paste-able code samples** — not a live
interactive demo.

## Non-goals

- No live/interactive backend demo (impossible for a server-side lib in a static site).
- No auto-generated API reference (TypeDoc). Content is hand-written tour + samples. Accepted
  tradeoff: the site can drift from code over time; it will not drift-break the build.
- No separate docs repo. Single repo, single PR.
- Not changing the library's public API, version, or release flow (the user bumps 1.0.0 separately).

---

## Decisions (from brainstorming)

| Decision | Choice | Why |
|---|---|---|
| Generator | **VitePress** | Lightweight, Vue-based, best DX for code-heavy docs, trivial GH Pages deploy |
| Content depth | **Tour + samples** | Matches README depth; hand-written; no TypeDoc machinery |
| Location | **`site/` in lib repo** | One repo, one PR, simplest |
| Branch | **`release/0.1.0`** | Bundle with the 1.0.0 release |
| Deploy trigger | **push to `main`** | Pages publishes when the release merges to main |

---

## Part 1 — README refresh (in place, `README.md`)

The existing README is comprehensive and already declares `1.0.0`. Targeted fixes only:

1. **Required-peers gap.** The Installation section lists only `bullmq` + `@nestjs/bullmq` as
   always-required. But `package.json` also makes `@nestjs/platform-express` and `@nestjs/schedule`
   required (they are NOT in `peerDependenciesMeta.optional`). Add both to the required list, with a
   one-line note on what each enables (`FileInterceptor` for uploads; `@Cron` for the cleanup job).

2. **`features` sub-path row.** In the Sub-paths table, extend the `@sdcorejs/nestjs/features` row to
   mention the two drop-in controllers (`UploadedFileController`, `ActionHistoryController`).

3. **New `## Features` section** (placed after `## Internationalised errors`, before `## Philosophy`).
   Deep-dive the three stateful feature modules using the verified APIs:

   - **Uploaded files** (`@sdcorejs/nestjs/features`)
     - Wire via `SdCoreModule.forRoot({ uploadedFile: { driver?, bucket?, folder?, host?, cdnBaseUrl?, cleanupAfterDays? } })`.
       Driver auto-detected: `s3` when creds present, else `local`.
     - `UploadedFileService`: `upload<TExtra>(buffer, fileName?, meta?, extraData?)` → full `UploadedFile<TExtra>`;
       `download(id)` → `{ stream, fileName }`; `findById<TExtra>(id)`; `setExtraData<TExtra>(id, extraData)`;
       plus `useFiles` / `markUsed` / `delete`.
     - `UploadedFile<TExtraData>` generic entity + `extraData` jsonb bag.
     - Drop-in `UploadedFileController` — `POST /uploaded-file` (multipart `file`, optional
       `module`/`entity`/`entityId`/`type` query) + `GET /uploaded-file/:id/download`. **NOT
       auto-registered** — add the class to one of your modules' `controllers` so it inherits that
       module's route prefix (e.g. a `core`-routed module → `POST /core/uploaded-file`). Guarded by
       the lib `AuthGuard`; requires `@nestjs/platform-express`.
     - `cleanupAfterDays` — opt-in daily `@Cron('0 3 * * *')` purge of never-attached files
       (`isUsed = false`) older than N days. Requires `ScheduleModule.forRoot()` in the host. When the
       job-scheduler feature is also wired, each sweep is guarded by the distributed DB lock so only
       one instance purges.

   - **Action history** (`@sdcorejs/nestjs/features`)
     - `ActionHistoryService.record(entry)` (called by `BaseRepository` CUD when `logHistory` is on)
       and `all(tableId)`. Acting user resolved per request from `ContextService` (default `ctx.userId`)
       or a consumer `resolveActor(ctx)`.
     - Drop-in `ActionHistoryController` — `GET /action-history/:tableId`. NOT auto-registered; same
       mounting rule as above. Guarded by `AuthGuard`.

   - **Job scheduler** (`@sdcorejs/nestjs/features`)
     - `JobSchedulerService.runExclusive({ code, runKey?, type? }, fn)` — distributed cron lock:
       atomic `INSERT ... ON CONFLICT DO NOTHING`; on conflict, re-claim ONLY a previously `FAIL`
       run (`SUCCESS`/`RUNNING` stay locked). Single winner runs `fn`, records `SUCCESS`/`FAIL`;
       losers return `{ acquired: false }`.

4. **Showcase link.** Add a link to the published site near the top of the README
   (`https://sdcorejs.github.io/sdcorejs-nestjs/`).

---

## Part 2 — VitePress showcase site (`site/`)

```
site/
  package.json              # vitepress as the only dependency (devDependency) — isolated from lib deps
  .gitignore                # node_modules, .vitepress/dist, .vitepress/cache
  .vitepress/
    config.ts               # base:'/sdcorejs-nestjs/', title, description, nav, sidebar, socialLinks → repo
  index.md                  # VitePress "home" layout: hero, tagline, feature grid, install snippet, 8-entry map
  guide/
    getting-started.md      # install (required + optional peers) + SdCoreModule.forRoot({...}) tour
    multi-tenancy.md        # @TenantScoped + ITenancyStrategy / inline resolve+bypass; read/write behavior
    permissions.md          # IPermissionStrategy.load/check + AuthGuard + @HasPermission/@HasAnyPermission
    jwt-keycloak.md         # KeycloakJwtStrategy (JWKS, multi-realm) + symmetric secret; validate() override
    internal-calls.md       # InternalGuard + IInternalSecretProvider (rotation) + IInternalContextEnricher
    request-context.md      # ContextService (ALS), accessor table, declaration merging
    orm-base-classes.md     # BaseEntity/Repository/Service/Controller; endpoint table; @SearchableFields/@Schema
    validation.md           # ZodValidationGuard, presets (zPaging/zUuid/zBool), i18n-code messages, guard order
    i18n.md                 # SdI18nExceptionFilter, SimpleI18nResolver, DefaultLanguageResolver, CORE_CATALOGS
    features.md             # UploadedFile / ActionHistory / JobScheduler deep-dive (mirrors README Part 1 #3)
```

**Content source:** each guide page lifts the corresponding README section (already written, accurate)
into a standalone page, lightly expanded for the page format. `features.md` mirrors the new README
Features section. `index.md` is the only net-new prose (hero + feature grid + entry map).

**`config.ts` essentials:**
- `base: '/sdcorejs-nestjs/'` (GitHub project-pages path).
- `title: '@sdcorejs/nestjs'`, `description` from `package.json`.
- `themeConfig.nav`: Guide, GitHub, npm.
- `themeConfig.sidebar`: a single "Guide" group listing the pages above in tour order.
- `themeConfig.socialLinks`: GitHub repo.
- `lang: 'en-US'`. Default VitePress theme (no custom CSS needed for v1).

**`site/package.json`:** `private: true`, scripts `docs:dev` / `docs:build` / `docs:preview`,
devDependency `vitepress` (pinned to a current stable). Isolated `node_modules` under `site/` — the
lib's own build/test toolchain is untouched.

---

## Part 3 — GitHub Action (`.github/workflows/docs.yml`)

```yaml
name: docs
on:
  push:
    branches: [main]
    paths: ['site/**', 'README.md', '.github/workflows/docs.yml']
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: false
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm, cache-dependency-path: site/package-lock.json }
      - run: npm ci
        working-directory: site
      - run: npm run docs:build
        working-directory: site
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with: { path: site/.vitepress/dist }
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

(Final action versions/Node version confirmed at implementation time.) A `site/package-lock.json`
is committed so `npm ci` works in CI.

**Manual one-time step (documented, cannot be automated here):** repo **Settings → Pages → Build and
deployment → Source = "GitHub Actions"**. After that, every push to `main` touching the paths above
publishes to `https://sdcorejs.github.io/sdcorejs-nestjs/`.

---

## Verification

1. `cd site && npm install && npm run docs:build` → exits 0, produces `site/.vitepress/dist/index.html`.
2. `npm run docs:preview` (or open dist) → spot-check: home renders; every guide page in the sidebar
   loads; code blocks are syntax-highlighted; internal links resolve under the `/sdcorejs-nestjs/` base.
3. README diff review: required peers now include `@nestjs/platform-express` + `@nestjs/schedule`;
   `## Features` section present and matches the verified APIs; showcase link present.
4. `docs.yml` validated (YAML lints; action refs resolve). Live publish confirmed after merge to `main`
   + the one-time Pages source setting.

## Risks / tradeoffs

- **Content duplication** README ↔ site guide pages. Accepted — both are hand-maintained; the site is
  the richer surface, README the npm-page summary.
- **Drift** Hand-written samples can lag code. Accepted for a showcase; no build coupling means drift
  never breaks CI.
- **Pages not yet enabled** The first deploy fails until the manual Settings → Pages source is set.
  Documented in Part 3.
