# 1.3.1 security remediation and release evidence

Repository overrides do not propagate into an installed npm dependency. The initial
packed 1.3.1 consumer reproduced six production findings (two high, four moderate)
through Nest's pinned multer and TypeORM's glob/minimatch chain, even after the
repository audit reached zero. A root-only audit was therefore insufficient.

## Runtime dependency distribution

The approved backport scope uses integrity-verified upstream TypeORM 0.3.31 and
Nest Express adapter 11.2.8 tarballs, changing only their dependency metadata to
glob 14.0.3 and multer 2.5.0. Upstream runtime files remain unchanged. The absent
TypeORM MIT license is added from its exact upstream release tag. The artifacts,
provenance, integrity records and reproducible-content verifier are in `backports/`.

Peer-only requirements point to immutable commit-addressed HTTPS tarballs. Real
fresh installs and upgrades from a locked 1.3.0 application with exact upstream
TypeORM/Nest versions resolved one shared TypeORM and adapter, with zero findings.
The application, library and Nest TypeORM integration share DataSource, EntityManager,
Repository and EntitySchema classes and DI tokens. No consumer overrides, aliases,
postinstall mutation, new npm publishing credential or TypeORM major migration is used.

See [consumer installation notes](migration-1.3.1-security.md). A retained merge
ancestor or artifact tag must keep the referenced artifact commit reachable.

## Development and documentation dependencies

Jest's dev-only deepmerge is replaced by a private, MIT-licensed hardened fork.
Security tests reproduce prototype poisoning against upstream 4.3.1 and resolve
the actual Jest dependency after replacement. Target and source keys are checked
before access; writes use own data properties; proxy membership errors propagate.
The fork and tests are excluded from the published runtime package.

Scoped overrides upgrade affected modern glob/minimatch while preserving legacy
glob 7/minimatch 3 callers. Follow-redirects is fixed at 1.16.2 and the docs-only Vite
override at 6.4.5. TypeORM directory discovery compatibility is tested with CommonJS,
ESM, nested/brace patterns and JSON schemas.

## Active release gate

The expired 1.3.0 exception is archived unchanged in
`release-audit-exception-20261028.policy.json`; it is never accepted by the active gate.
All findings, including low and informational findings, block this release.

Five scopes must pass: repository, production, docs, fresh consumer and upgrade
consumer. Reports retain raw exit/output hashes. Publication requires evidence no
older than one hour, tied to the same runtime source, manifests, locks, tooling and
exact package tarball. Missing, stale, mismatched, malformed or nonzero reports fail
closed. Both consumer receipts must include real PostgreSQL verification. The archive
SHA-512 is independently computed and matched to npm metadata; the runtime archive
check excludes development tooling and bundled copies.

The existing CI workflow executes these checks without permission or workflow changes:

- `test:coverage`: backport reproduction, tooling/security tests and all Jest tests.
- `test:postgres`: existing packed PostgreSQL regressions and fresh/upgrade consumer
  installs, shared identity checks, SingleFlight/cache CJS+ESM tests, and actual
  PostgreSQL paging/read-runner tests through both installed consumer packages.
- Existing lint, format, typecheck, examples, publication, DI, exports and docs gates.
- `core-release-audit.mjs`: live audits and publication evidence verification.

Local final checks use Node 26 on Annie; supported Node 20/22 execution is provided
by CI and must pass before merge. Actions retain raw audit reports, package integrity
and consumer receipts under `test-results/release-audit/` for independent inspection.
