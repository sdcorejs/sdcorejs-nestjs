---
layout: home

hero:
  name: "@sdcorejs/nestjs"
  text: "The cross-cutting NestJS kernel"
  tagline: "Base classes, multi-tenancy, audit, permission, request context, cache, HTTP, JWT/Keycloak, Zod validation, queue, i18n — every domain specific injected via DI strategies. Zero hardcoded column names."
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: Feature modules
      link: /guide/features
    - theme: alt
      text: GitHub
      link: https://github.com/sdcorejs/sdcorejs-nestjs

features:
  - title: One module wires it all
    details: "SdCoreModule.forRoot() composes context, tenancy, audit, permission, cache and HTTP. Opt-in keys add jwt, i18n, uploadedFile, actionHistory, jobScheduler and queue."
  - title: Neutral by design
    details: "No tenantCode/departmentCode baked in. You mark scoped columns with @Scoped() and write strategies; the library never knows your schema."
  - title: Multi-tenancy that just happens
    details: "BaseRepository injects a scope filter on every read and auto-fills scoped columns on every write. Scalar means EQUAL, array means IN. detail(id) is scoped too — no cross-tenant id leaks."
  - title: Permissions via DI strategy
    details: "IPermissionStrategy.load(ctx) resolves codes once per request; AuthGuard enforces @HasPermission / @HasAnyPermission and syncs user + permissions into the request context."
  - title: Keycloak / OIDC ready
    details: "KeycloakJwtStrategy verifies per-token against the issuer's JWKS — multiple realms and tenants work with no shared secret. Symmetric HS* secrets supported too."
  - title: Drop-in feature modules
    details: "Uploaded files (S3/local, extraData jsonb, 03:00 cron cleanup), action history, and a distributed cron lock — each with an optional drop-in controller."
  - title: i18n error envelopes
    details: "Producers throw i18n codes, not sentences. SdI18nExceptionFilter localizes per request language into a localized error envelope. Built-in en/vi core.* catalogs."
  - title: Dual ESM + CJS, fully typed
    details: "8 grouped entry points, per-format type declarations, publint + attw green on every entry. Import only what you use."
---

## Install

<p>
  <a href="https://www.npmjs.com/package/@sdcorejs/nestjs"><img src="https://img.shields.io/npm/v/@sdcorejs/nestjs.svg?logo=npm&color=crimson" alt="npm version" /></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/node/v/@sdcorejs/nestjs.svg?label=node" alt="node" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/npm/l/@sdcorejs/nestjs.svg" alt="license" /></a>
  <a href="https://github.com/sdcorejs/sdcorejs-nestjs/actions"><img src="https://img.shields.io/github/actions/workflow/status/sdcorejs/sdcorejs-nestjs/ci.yml?label=CI&logo=github" alt="CI" /></a>
  <a href="https://github.com/sdcorejs/sdcorejs-nestjs"><img src="https://img.shields.io/badge/coverage-93%25-brightgreen" alt="coverage" /></a>
</p>

```bash
npm install @sdcorejs/nestjs
```

**Only two peer dependencies** — `@nestjs/common ^11` and `@nestjs/core ^11`, which every NestJS app
already has. Everything else is bundled and installs automatically. Optional feature libs (`ioredis`,
`zod@^4`, `jwks-rsa@^4` + `jsonwebtoken`, `aws-sdk`) ship as `optionalDependencies`.
See [Getting started](/guide/getting-started) for the full matrix.

## The 8 entry points

| Import | What's inside |
|---|---|
| `@sdcorejs/nestjs` | `SdCoreModule.forRoot({...})` + ergonomic re-exports |
| `@sdcorejs/nestjs/core` | ORM base classes, request context, multi-tenancy, audit |
| `@sdcorejs/nestjs/auth` | JWT / Keycloak strategies + permission guards & decorators |
| `@sdcorejs/nestjs/services` | context-aware HTTP client + cache (memory / redis) |
| `@sdcorejs/nestjs/queue` | BullMQ `QueueModule` + `SdWorkerHost` |
| `@sdcorejs/nestjs/validation` | `ZodValidationGuard` + query presets (Zod v4) |
| `@sdcorejs/nestjs/i18n` | i18n resolver + exception filter + en/vi `core.*` catalogs |
| `@sdcorejs/nestjs/features` | `UploadedFile`, `ActionHistory`, `JobScheduler` + drop-in controllers |
