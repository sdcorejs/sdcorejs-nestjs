# Multi-tenancy

Tenancy is enforced by **your** `ITenancyStrategy`, injected before every query reaches the database.
The library never knows your column names — you mark scoped columns with `@Scoped()` (the
decorator uses the **property name** as the column) and return scope values from the strategy.

## 1. Mark scoped columns on the entity

```ts
import { Entity, Column } from 'typeorm';
import { BaseEntity, WithAudit, Scoped } from '@sdcorejs/nestjs/core';

@Entity()
export class Product extends WithAudit(BaseEntity) {
  @Column() name!: string;
  @Column() @Scoped() tenantCode!: string;
  @Column({ nullable: true }) @Scoped() departmentCode?: string;
}
```

## 2. Supply the scope via DI

```ts
import { Injectable } from '@nestjs/common';
import { ContextService } from '@sdcorejs/nestjs/core';
import type { ITenancyStrategy, RequestContext } from '@sdcorejs/nestjs/core';

@Injectable()
export class AppTenancyStrategy implements ITenancyStrategy {
  getCurrentScope(ctx: RequestContext): Record<string, unknown> {
    return {
      tenantCode: ctx.tenant,                            // scalar → EQUAL filter
      departmentCode: ctx.custom?.['departmentCodes'],   // array → IN filter
    };
  }
  shouldBypass(ctx: RequestContext): boolean {
    return ctx.custom?.['isInternalCall'] === true;      // admin / internal callers see everything
  }
}
```

Or skip the class entirely and pass inline callbacks to `SdCoreModule.forRoot({ tenancy: { resolve, bypass } })`
(see [Getting started](/guide/getting-started)).

## What the library does for you

When a strategy is registered, `BaseRepository`:

- **Reads** (`paging`, `all`, `search`, `detail`) — injects a scope filter per `@Scoped` column. A
  **scalar** scope value becomes `EQUAL`; an **array** becomes `IN` (multi-department users); `null` /
  `undefined` / empty array is skipped.
- **Writes** (`create`, `import`) — auto-fills the scoped columns from `getCurrentScope()`.
- **`detail(id)`** is scoped too — fetching a known UUID that belongs to another tenant returns `null`
  (no cross-tenant id leak).
- **`shouldBypass(ctx) === true`** skips both filter injection and auto-fill.

::: info no strategy = no overhead
With no strategy registered, the repository behaves as if tenancy is disabled.
:::
