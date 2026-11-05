# Dependency metadata backports

These are SDCoreJS-maintained repacks, **not official upstream releases**. They retain
the upstream package names and versions to preserve NestJS 11 / TypeORM 0.3 API and
peer compatibility. `package.json.sdcorejsBackport` identifies each repack explicitly.

The only changed upstream file is `package.json`: TypeORM 0.3.31 uses patched glob 14.0.3, and the NestJS
11.2.8 Express adapter uses patched multer 2.5.0. Every runtime source, declaration,
source map and license file is byte-identical to the integrity-verified upstream
tarball. The TypeORM npm archive omits its MIT license; this repack additionally
includes `package/LICENSE` from the upstream 0.3.31 source tag, with its source and
integrity recorded. `manifest.json` records the original and patched dependency values and
SHA-512 identities. The tar content rewrite is deterministic and runs no upstream scripts.
Verification checks the committed compressed bytes against their exact SHA-512 and
reproduces decompressed tar bytes exactly; compression output may vary by zlib version.

Reproduce and verify the committed archives with:

```sh
node scripts/build-dependency-backports.mjs
```

Use `--write` only to regenerate deliberately reviewed backports. The package's
runtime metadata references these artifacts through immutable commit-addressed HTTPS
URLs as **peer-only** dependencies. npm installs them at the application boundary so
the application, this library and `@nestjs/typeorm` share the same class/DI identities.
Do not add the same dependencies back to `dependencies`, use mutable branch URLs,
or substitute same-version aliases: those can retain an upstream vulnerable tree or
create a nested TypeORM instance.

The release gate verifies clean new installs and upgrades from 1.3.0 without consumer
overrides, including existing exact-version dependencies and lockfiles. It checks
the installed backport markers, dependency paths, CJS/ESM exports and shared Nest/ORM
identities. Applications using another package manager or restricting GitHub tarball
downloads must validate their installation policy before updating. No postinstall
mutation or credential is needed by consumers.

Remove this distribution once compatible upstream metadata selects patched dependencies
and the same consumer gates pass. Changes require a new artifact revision and immutable
URL; never replace bytes at an existing reference. The dev-only Jest merge fork remains
separate and is excluded from the published runtime package.

Advisories: [glob](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4),
[minimatch](https://github.com/advisories/GHSA-g3hv-75wg-m249),
[multer](https://github.com/advisories/GHSA-q7qp-rjg7-q26m).
