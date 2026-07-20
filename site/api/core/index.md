# Core API

Import path: `@sdcorejs/nestjs/core`

The core entrypoint contains four cooperating surfaces:

- [ORM](./orm.md) — TypeORM entities/mixins, repositories, services, controllers, query types and
  history bridge.
- [Request context](./context.md) — AsyncLocalStorage and trusted identity mapping.
- [Multi-tenancy](./tenancy.md) — scope decorators, strategies, fail-closed enforcement and audited
  privileged grants.
- [Audit](./audit.md) — actor-field strategy and TypeORM subscriber.

## Typical flow

```text
verified JWT principal
  -> ContextService identity
  -> tenancy/audit strategies
  -> BaseRepository scoped query or mutation
  -> optional ActionHistory recorder
```

```ts
import {
  BaseEntity,
  BaseRepository,
  ContextService,
  Scoped,
  WithAudit,
  type ITenancyStrategy,
} from '@sdcorejs/nestjs/core';
```

Start with [ORM](./orm.md) for a complete entity/repository/service/controller example. Every
scoped entity must also follow the [tenancy configuration](./tenancy.md); missing required scope
fails closed rather than falling back to global data.

## Database target

The query layer and built-in column types target PostgreSQL. Text search depends on `unaccent`,
JSON paths use PostgreSQL operators, imports use `RETURNING`, and ordering specifies null position.
See [PostgreSQL behavior](./orm.md#postgresql-behavior) before choosing a datasource engine.
