# Action history

Action history stores tenant-scoped CREATE, UPDATE, and DELETE snapshots. It is separate from the
current-row audit fields supplied by `WithAudit`.

## Enable secure recording and reads

```ts
import { SdCoreModule } from '@sdcorejs/nestjs';

SdCoreModule.forRoot({
  actionHistory: {
    resolveActor: (context) => {
      const user = context.user as {
        email?: string;
        displayName?: string;
      } | undefined;
      return {
        userId: context.userId,
        username: user?.email,
        fullName: user?.displayName,
      };
    },
    authorizeRead: ({ context, tenantCode }) =>
      context.tenant === tenantCode &&
      context.permissions?.includes('history:read') === true,
    redactFields: ['customer.taxId', 'payment.cardLastFour'],
    maxPageSize: 50,
    retentionDays: 365,
  },
});
```

Register `ActionHistory` with TypeORM through `autoLoadEntities: true` or an explicit entity list
and a migration. Omitting `authorizeRead` denies every read.

`retentionDays` is an operations/documentation hint. The library does not delete audit history;
implement and approve retention in the consuming application according to compliance requirements.

## Automatic repository history

Enable `logHistory` in a concrete repository:

```ts
super(Product, dataSource, {
  contextService: context,
  tenancyStrategy: tenancy,
  auditStrategy: audit,
  logHistory: true,
});
```

This is the final line of a `BaseRepository` constructor; the complete constructor is shown in
[ORM base classes](/guide/orm-base-classes).

The action-history module registers `ActionHistoryService` as the process-wide recorder by default.
Repository history uses the stable, schema-qualified TypeORM `tablePath`, copies scope from the
persisted resource, and writes through the active mutation transaction.

For scoped resources, every scope field must be available from the persisted row. A missing scope
throws `MissingHistoryResourceScopeError` before commit. By default, history tenant attribution
uses `resourceScope.tenantCode`.

If the entity uses a different tenant property, configure a synchronous resolver:

```ts
resolveResourceTenant: ({ resourceScope }) =>
  typeof resourceScope.organizationCode === 'string'
    ? resourceScope.organizationCode
    : undefined,
```

Returning no trusted tenant throws `MissingActionHistoryResourceTenantError`. A resolver that
conflicts with an existing `tenantCode` is also rejected.

## Manual records

```ts
import { Injectable } from '@nestjs/common';
import {
  ActionHistoryService,
  ActionHistoryType,
} from '@sdcorejs/nestjs/features';

@Injectable()
class ApprovalHistory {
  constructor(private readonly history: ActionHistoryService) {}

  recordApproval(orderId: string, before: unknown, after: unknown) {
    return this.history.create({
      table: 'public.order',
      tableId: orderId,
      type: ActionHistoryType.UPDATE,
      fromData: before,
      toData: after,
      note: 'Approval state changed',
    });
  }
}
```

Manual writes require a trusted tenant in `ContextService`. Prefer automatic repository recording
when the history row must commit atomically with the resource mutation.

## Read API

```ts
const page = await history.all({
  table: dataSource.getMetadata(Product).tablePath,
  tableId: productId,
  pageNumber: 0,
  pageSize: 25,
});
```

The focused fragment assumes injected `history: ActionHistoryService`, a TypeORM `dataSource`, the
`Product` entity, and a UUID `productId` from application code.

Reads require tenant + exact table path + UUID + explicit policy approval. Missing, malformed,
cross-tenant, and denied resources all return the same 404. Pages are 0-based, ordered newest first,
and capped by configured `maxPageSize`; the absolute maximum is 200 and the database offset is
bounded.

## Mount the controller explicitly

```ts
import { Module } from '@nestjs/common';
import { ActionHistoryController } from '@sdcorejs/nestjs/features';

@Module({
  controllers: [ActionHistoryController],
})
export class HistoryHttpModule {}
```

The controller is not auto-registered. It exposes
`GET /action-history/:table/:tableId?pageNumber=0&pageSize=50`, returns 200 with a standard data
envelope, uses `AuthGuard`, and still delegates resource authorization to `authorizeRead`.

## Redaction and limits

Before persistence, snapshots pass through:

1. optional application `redactSnapshot`;
2. configured exact/dotted-path redaction;
3. recursive built-in secret-name redaction.

Common password, token, secret, authorization, API/access/private-key, and credential field names are
redacted even when nested. Cycles are replaced safely. Fixed defensive limits are depth 32, 10,000
nodes, and 1 MiB of traversed UTF-8 material; exceeding a limit throws
`ActionHistorySnapshotLimitError` before persistence.

Do not treat redaction as permission. Snapshots may contain other sensitive business data, so keep
`authorizeRead` resource-specific and audit access to the history endpoint.
