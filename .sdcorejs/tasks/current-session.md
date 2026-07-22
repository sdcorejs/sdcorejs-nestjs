---
updated_at: 2026-07-22T07:47:45.6965202+07:00
status: in_progress
track: nestjs
active_skill: github:gh-fix-ci + sdcorejs-debug + sdcorejs-documentation
branch: chore/prepare-release-1.1.1
---

# Current Session Checkpoint

## User Request
Fix the Node 22 documentation coverage failure on pull request #4.

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
- [ ] Run Node 22 verification, commit, push, and recheck CI.

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
- Blocked/skipped: none; the user approved the focused documentation fix.

## Artifacts Touched
- CREATE `.sdcorejs/tasks/current-session.md` - durable checkpoint for the corrected release.
- EDIT `site/api/validation.md` and `site/vi/api/validation.md` - document `zUuidV4`.
- EDIT `site/api/features/action-history.md` and `site/vi/api/features/action-history.md` - document `ActionHistoryUnsafeSnapshotError`.

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
- Full dev audit retains one transitive high advisory in `immutable<=4.3.8`; no production dependency is affected.
- Local Node `v22.22.2`: `npm run docs:check-api` failed identically on 3/3 runs with only the four missing-locale references.
- Local Node `v22.22.2`: `npm run docs:check` passed, including typecheck, locale/link/API checks and VitePress build.

## Resume From Here
Commit the five scoped files, push to PR #4, and recheck the Node 22 GitHub Actions job.
