# Multi-tenancy

Tenancy is enforced by `BaseRepository`. The library does not assume a column name: mark each scope
dimension with `@Scoped()`, then return values keyed by those entity property names.

## Define a scoped entity

```ts
import { Column, Entity } from 'typeorm';
import {
  BaseEntity,
  Scoped,
  SearchableFields,
  WithAudit,
} from '@sdcorejs/nestjs/core';

@SearchableFields({ exact: ['sku'], contain: ['name'], activeColumn: 'isActive' })
@Entity('product')
export class Product extends WithAudit(BaseEntity) {
  @Column({ length: 64 })
  @Scoped()
  tenantCode!: string;

  @Column({ length: 64, nullable: true })
  @Scoped({ required: false })
  departmentCode?: string;

  @Column({ length: 64 })
  sku!: string;

  @Column()
  name!: string;

  @Column({ default: true })
  isActive!: boolean;
}
```

`@Scoped()` is required by default. A missing/null required value, blank string, invalid date, or
other invalid scope fails before the query. An allowed-values array becomes an `IN` predicate; an
empty array matches no rows. Use `required: false` only for a deliberate optional dimension.

## Configure scope resolution

Inline callbacks are enough for simple applications:

```ts
import { SdCoreModule } from '@sdcorejs/nestjs';

SdCoreModule.forRoot({
  tenancy: {
    resolve: (context) => ({
      tenantCode: context.tenant,
      departmentCode: context.custom?.departmentCode,
    }),
  },
});
```

For injected dependencies, implement a strategy class:

```ts
import { Injectable } from '@nestjs/common';
import type {
  ITenancyStrategy,
  RequestContext,
  TenancyBypassGrant,
} from '@sdcorejs/nestjs/core';

@Injectable()
export class AppTenancyStrategy implements ITenancyStrategy {
  getCurrentScope(context: RequestContext): Record<string, unknown> {
    return {
      tenantCode: context.tenant,
      departmentCode: context.custom?.departmentCode,
    };
  }

  shouldBypass(): boolean {
    return false;
  }

  getBypassGrant(_context: RequestContext): TenancyBypassGrant | undefined {
    return undefined;
  }
}
```

Register it with `tenancy: { strategy: AppTenancyStrategy }`.

## Enforced operations

For a scoped entity, the repository applies the same canonical scope to:

- paging, deleted paging, all, search, detail, and relation joins;
- create and bulk import (scope is filled from trusted context);
- update, hard delete, soft delete, and restore; and
- batch ID lookup and affected-row verification.

Ordinary updates cannot move a row across a scope dimension. Scoped mutations include ID and scope
in SQL and reject partial batch matches. Entities without `@Scoped()` keep ordinary TypeORM
behavior.

## Privileged bypass grants

A boolean bypass cannot authorize an unscoped query. A valid grant must be narrow, attributable, and
audited synchronously:

```ts
import type { TenancyBypassAuditEvent } from '@sdcorejs/nestjs/core';

function writePrivilegedAuditSynchronously(event: TenancyBypassAuditEvent): void {
  process.stdout.write(JSON.stringify(event) + '\n');
}

const tenancy = {
  resolve: (context: { tenant?: string }) => ({ tenantCode: context.tenant }),
  bypassGrant: (context: { userId?: string; roles?: string[] }) => {
    if (!context.userId || !context.roles?.includes('platform-admin')) return undefined;

    return {
      authorized: true as const,
      actorId: context.userId,
      reason: 'approved product export',
      allowedTargets: ['public.product'],
      allowedOperations: ['read'] as const,
      audit: writePrivilegedAuditSynchronously,
    };
  },
};
```

`public.product` is an example only. Replace it with
`dataSource.getMetadata(Product).tablePath` in application configuration. The callback must
complete synchronously and return `undefined`; an async callback is rejected because the repository
cannot prove it finished before issuing SQL. In production, write to a durable synchronous audit
sink appropriate to your architecture rather than standard output.

## Unsafe TypeORM access

`unsafeRepository`, `unsafeGetRepository()`, and `unsafeCreateQueryRunner()` deliberately bypass
tenancy, mutation guards, and affected-row checks. Their names are an operational boundary, not a
convenience API. Restrict them to reviewed maintenance code with separate authorization and audit.
