---
updated_at: 2026-07-22T09:17:14.7633912+07:00
status: complete
track: nestjs
active_skill: github:gh-fix-ci + sdcorejs-ship + sdcorejs-git
branch: chore/prepare-release-1.1.1
---

# Current Session Checkpoint

## User Request
Fix all remaining Node 22 CI failures on pull request #4.

## Tasks
- [x] Create a clean release branch for `1.1.1`.
- [x] Apply the implementation and formatting with a patch Changeset.
- [x] Generate the `1.1.1` package metadata, lockfile, and changelog.
- [x] Run full verification and package smoke checks.
- [x] Commit the release and verify branch readiness.
- [x] Confirm the GitHub remote and check for an existing pull request.
- [x] Push `chore/prepare-release-1.1.1` to `origin`.
- [x] Open a draft pull request against the default branch.
- [x] Record the pull request URL and final handoff state.
- [x] Inspect the failing Node 22 GitHub Actions check.
- [x] Reproduce and isolate the documentation coverage failure locally.
- [x] Obtain approval for the focused documentation fix.
- [x] Update English and Vietnamese API documentation.
- [x] Run Node 22 documentation verification, commit, and push the documentation fix.
- [x] Inspect the newly revealed dependency-audit failure.
- [x] Obtain approval for the dependency-security update.
- [x] Update the TypeORM constraint and lock the fixed TypeORM/Immutable versions.
- [x] Run regression and audit checks on Node 22.
- [x] Commit, push, and recheck CI.

## Current State
- Implementation commit: `619b948` (`fix(core): adopt @sdcorejs/utils 1.2.0`).
- Release commit: `45ff35c` (`chore(release): bump @sdcorejs/nestjs to 1.1.1`).
- Package version: `@sdcorejs/nestjs` 1.1.1.
- Dependency version: `@sdcorejs/utils` 1.2.0.
- GitHub CLI: authenticated as `sdcorejs`.
- Pull request preflight: `sdcorejs/sdcorejs-nestjs`, base `main`, no existing PR for this branch.
- Draft pull request: `https://github.com/sdcorejs/sdcorejs-nestjs/pull/4`.
- CI failure: Node 22 runs `docs:check`; Node 20 skips this step in `ci.yml`.
- Observed missing documentation references: `zUuidV4` and `ActionHistoryUnsafeSnapshotError` in both locales.
- Root cause: the PR exports two new public symbols without adding them to the API reference pages checked by `docs:check-api`.
- Last completed: documented both symbols in the English and Vietnamese API reference pages.
- Documentation fix commit: `ccf131e` (`docs(api): cover new public exports`).
- CI follow-up: documentation now passes; the next Node 22 step fails `npm audit` on `typeorm@0.3.30` and `immutable@4.3.8`.
- Dependency fix: require `typeorm@^0.3.31` and override the `pg-mem` development tree to `immutable@4.3.9`.
- Lockfile confirms TypeORM 0.3.31 and Immutable 4.3.9 with only expected TypeORM patch transitives.
- Dependency fix commit: `cc06463` (`fix(deps): resolve audit advisories`).
- GitHub Actions run `29885303002` passed on Node 20 and Node 22, including Node 22 docs and audits.
- Blocked/skipped: none; the user explicitly requested checking and fixing the remaining failure.

## Artifacts Touched
- CREATE `.sdcorejs/tasks/current-session.md` - durable checkpoint for the corrected release.
- EDIT `site/api/validation.md` and `site/vi/api/validation.md` - document `zUuidV4`.
- EDIT `site/api/features/action-history.md` and `site/vi/api/features/action-history.md` - document `ActionHistoryUnsafeSnapshotError`.
- EDIT `package.json` and `package-lock.json` - resolve TypeORM and Immutable audit advisories.
- EDIT `CHANGELOG.md` - record the TypeORM security floor for release 1.1.1.

## Verification
- `npm run format:check`: passed.
- `npm run lint`: passed.
- `npm run typecheck`: passed.
- Unit tests: 69/69 suites and 681/681 tests passed.
- E2E tests: 1/1 suite and 3/3 tests passed.
- `npm run build`: passed for CJS, ESM, and declarations.
- `npm run check:package-di`: passed.
- `npm run check:exports`: passed (`publint` and Are The Types Wrong found no problems).
- `npm run examples:typecheck`: passed.
- CJS and ESM `zUuidV4` smoke checks: passed.
- `npm pack --dry-run --json`: produced `sdcorejs-nestjs-1.1.1.tgz`.
- `npm audit --omit=dev`: 0 vulnerabilities.
- Root and site audits: 0 vulnerabilities after the dependency update.
- Local Node `v22.22.2`: `npm run docs:check-api` failed identically on 3/3 runs with only the four missing-locale references.
- Local Node `v22.22.2`: `npm run docs:check` passed, including typecheck, locale/link/API checks and VitePress build.
- GitHub Actions run `29881296482`: Node 20 passed; Node 22 documentation passed, then root audit failed (TypeORM moderate, Immutable high). Site audit is clean.
- Node `v22.22.2`: lint, format, typecheck and example typecheck passed.
- Unit coverage run: 69/69 suites and 681/681 tests passed; E2E: 3/3 passed.
- Build, package DI, exports, CJS/ESM smoke, docs check and `npm pack` for 1.1.1 passed.

## Resume From Here
PR #4 is ready for review; convert it from draft when maintainers are ready. Tagging and publishing remain out of scope.
