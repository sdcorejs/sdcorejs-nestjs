# 1.3.1 dependency security update

Install or update with the usual command:

```sh
npm install @sdcorejs/nestjs@1.3.1
npm audit --omit=dev
```

The public NestJS and TypeORM APIs remain compatible. This version installs reviewed
SDCoreJS metadata backports of TypeORM 0.3.31 and `@nestjs/platform-express` 11.2.8
through peer requirements pointing to commit-addressed HTTPS tarballs in this repository.
They are not official upstream releases. Runtime code is unchanged: TypeORM now selects
glob 14.0.3, and the Express adapter selects multer 2.5.0. This also removes the vulnerable
minimatch chain. Package manifests contain `sdcorejsBackport` provenance.

The peer placement keeps one shared TypeORM and Nest adapter at the application root;
it avoids duplicate DataSource, EntityManager and Repository identities. npm installs the
peers automatically. The release gate tests fresh installs and upgrades from 1.3.0 with
existing exact-version TypeORM/Nest dependencies and lockfiles, without application
overrides. Do not use `--legacy-peer-deps` or bypass peer resolution.

The tarballs require access to `raw.githubusercontent.com`. If your organization uses a
restricted registry mirror or another package manager, validate its peer/tarball handling
before updating. Keep the resulting lockfile and integrity entries. An application with
additional independently vulnerable dependencies still needs its own audit and fixes.

See [backport sources, integrity records and reproduction instructions](https://github.com/sdcorejs/sdcorejs-nestjs/tree/0daebd798700ab3e58a5c0d060759ff3a0e4b8d7/backports).
Upstream licenses are retained; the omitted TypeORM MIT license is included from its
0.3.31 source tag. No install script patches application files or accesses credentials.

Jest's vulnerable configuration merger is replaced separately with a private, hardened
dev-only implementation. It is excluded from the runtime package. Repository, production,
docs and both consumer audit scopes must have zero findings. The expired 1.3.0 exception
does not apply to this version.
