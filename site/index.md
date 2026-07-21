---
layout: home

hero:
  name: '@sdcorejs/nestjs'
  text: 'Secure NestJS building blocks'
  tagline: 'Fail-closed TypeORM tenancy, trusted request identity, authorization, cache isolation, outbound HTTP, files, history, jobs, queues, validation, and i18n — shipped as eight stable entry points.'
  image:
    src: /images/sdcorejs-logo.png
    alt: SDCoreJS logo
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: Browse API
      link: /api/
    - theme: alt
      text: Complete examples
      link: /examples/

features:
  - title: Fail closed by default
    details: 'Scoped repositories reject missing tenancy, trusted identity never comes from arbitrary headers, file access defaults to owner-only, and history reads default to deny.'
  - title: Source-backed documentation
    details: 'Every public entry point has an API catalog, signatures, defaults, errors, security boundaries, and examples linked to focused guides.'
  - title: Production-oriented operations
    details: 'Durable file cleanup, fenced job leases, stable idempotency keys, Redis namespace isolation, PostgreSQL migration guidance, and explicit unsafe boundaries.'
  - title: NestJS 11 · Node 20+
    details: 'Dual ESM/CJS output, per-format declarations, PostgreSQL-backed TypeORM features, and CI coverage across Node.js 20 and 22.'
---

## Install

<p class="home-badges">
  <a href="https://www.npmjs.com/package/@sdcorejs/nestjs"><img src="https://img.shields.io/npm/v/@sdcorejs/nestjs.svg?logo=npm&color=crimson" alt="npm version" /></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/node/v/@sdcorejs/nestjs.svg?label=node" alt="Node.js support" /></a>
  <a href="https://github.com/sdcorejs/sdcorejs-nestjs/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/@sdcorejs/nestjs.svg" alt="MIT license" /></a>
  <a href="https://github.com/sdcorejs/sdcorejs-nestjs/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/sdcorejs/sdcorejs-nestjs/ci.yml?label=CI&logo=github" alt="CI status" /></a>
</p>

```bash
npm install @sdcorejs/nestjs
```

The only peer dependencies are `@nestjs/common ^11` and `@nestjs/core ^11`. Zod v4 is installed as a
required runtime because validation is part of the root API; `ioredis`, `jwks-rsa`, `jsonwebtoken`,
and `@aws-sdk/client-s3` remain optional feature runtimes.
Start with [installation](/guide/installation), then copy the [complete application example](/examples/complete-app).

## Choose the right entry point

| Import | Use it for |
| --- | --- |
| `@sdcorejs/nestjs` | `SdCoreModule`, common context/security primitives, response and validation helpers |
| `@sdcorejs/nestjs/core` | ORM, context, tenancy, audit |
| `@sdcorejs/nestjs/auth` | JWT/JWKS, permissions, internal calls |
| `@sdcorejs/nestjs/services` | Cache and outbound HTTP |
| `@sdcorejs/nestjs/validation` | Zod v4 guards and query presets |
| `@sdcorejs/nestjs/queue` | BullMQ registration and worker base class |
| `@sdcorejs/nestjs/i18n` | Catalogs, language resolution, localized exception envelopes |
| `@sdcorejs/nestjs/features` | Uploaded files, action history, distributed job scheduler |

These eight paths are the complete supported export map. Deep imports are intentionally unsupported.
See the [entry-point reference](/reference/entry-points) and [full API catalog](/api/).

## What changed in 1.1.0

Version 1.1.0 hardens shared-database and shared-infrastructure boundaries: trusted principal
mapping, fail-closed scoped mutations, cache namespaces, uploaded-file ownership and durable
cleanup, action-history authorization/redaction, and fenced job leases with stable idempotency keys.
It requires Node.js 20 or newer and an explicit coordinated migration for existing applications.

[Read the release notes](/releases/1.1.0) · [Upgrade from 1.0](/migrations/1.0-to-1.1) ·
[Security checklist](/reference/security)
