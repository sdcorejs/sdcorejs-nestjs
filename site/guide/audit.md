# Audit fields and change history

Two related mechanisms serve different purposes:

- `WithAudit(BaseEntity)` adds current audit columns to a domain row.
- the action-history feature stores a timeline of before/after snapshots.

## Audit columns

`WithTimestamps(BaseEntity)` adds `createdAt`, `updatedAt`, and `deletedAt`.
`WithAudit(BaseEntity)` includes those columns plus `createdBy`, `modifiedBy`, `creator`, and
`modifier`.

```ts
import { Column, Entity } from 'typeorm';
import { BaseEntity, WithAudit } from '@sdcorejs/nestjs/core';

@Entity('customer')
export class Customer extends WithAudit(BaseEntity) {
  @Column()
  name!: string;
}
```

The default audit strategy fills `createdBy` and `modifiedBy` from `ContextService.userId`. It
does not invent domain-shaped user snapshots for jsonb `creator` and `modifier` columns.

## Custom strategy

```ts
import { Injectable } from '@nestjs/common';
import type { DeepPartial } from 'typeorm';
import type {
  IAuditStrategy,
  RequestContext,
  UserSnapshot,
} from '@sdcorejs/nestjs/core';

@Injectable()
export class AppAuditStrategy implements IAuditStrategy {
  onCreate(entity: DeepPartial<Record<string, unknown>>, context: RequestContext): void {
    if (!context.userId) return;
    entity.createdBy = context.userId;
    entity.modifiedBy = context.userId;
    const principal = context.user as { email?: string; displayName?: string } | undefined;
    const snapshot: UserSnapshot = {
      id: context.userId,
      username: principal?.email ?? context.userId,
      fullName: principal?.displayName ?? '',
    };
    entity.creator = snapshot;
    entity.modifier = snapshot;
  }

  onUpdate(entity: DeepPartial<Record<string, unknown>>, context: RequestContext): void {
    if (context.userId) entity.modifiedBy = context.userId;
  }

  onSoftDelete(): void {}
}
```

Register it with `audit: { strategy: AppAuditStrategy }` and pass the injected strategy into each
`BaseRepository` that should fill fields.

## Direct TypeORM writes

`BaseRepository.create/update/import` invoke the configured strategy directly. Writes performed
through an ordinary TypeORM repository need `AuditSubscriber` added to the active `DataSource`:

```ts
import { DataSource } from 'typeorm';
import { AuditSubscriber } from '@sdcorejs/nestjs/core';

const subscriber = app.get(AuditSubscriber);
const dataSource = app.get(DataSource);
if (!dataSource.subscribers.includes(subscriber)) {
  dataSource.subscribers.push(subscriber);
}
```

The snippet belongs in bootstrap after creating `app` and before writes begin. The subscriber acts
only on entities created with `WithAudit`.

## Snapshot history

Set `logHistory: true` in a repository and enable `actionHistory` to persist CREATE, UPDATE, and
DELETE snapshots inside the mutation transaction. Read policy, redaction, retention, and controller
mounting are covered in [Action history](/guide/action-history).
