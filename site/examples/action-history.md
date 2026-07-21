# Action history

This recipe records Product mutations in the same database transaction and exposes an authenticated,
resource-authorized history endpoint. It reuses the `Product` and `ProductRepository` from the
[complete application](/examples/complete-app), including its JWT, context, tenancy, and TypeORM
configuration.

## Configure the feature

```ts
import { SdCoreModule } from '@sdcorejs/nestjs';

SdCoreModule.forRoot({
  actionHistory: {
    resolveActor: (context) => {
      const principal = context.user as {
        email?: string;
        displayName?: string;
      } | undefined;
      return {
        userId: context.userId,
        username: principal?.email,
        fullName: principal?.displayName,
      };
    },
    authorizeRead: ({ context, tenantCode, table }) =>
      context.tenant === tenantCode &&
      table === 'public.product' &&
      context.permissions?.includes('product:history:read') === true,
    redactFields: ['costPrice', 'supplier.apiToken'],
    maxPageSize: 50,
    retentionDays: 365,
  },
});
```

Merge these `actionHistory` options into the existing root call; do not register a second
`SdCoreModule`. The standalone fragment isolates the options for readability.

`public.product` is an example TypeORM `tablePath`; use
`dataSource.getMetadata(Product).tablePath` when building policy in your application so naming
strategy/schema changes stay correct. Omitting `authorizeRead` denies all reads.

The repository constructor must include `logHistory: true`. The feature registers its recorder by
default, and a scoped CREATE/UPDATE/DELETE snapshot uses scope copied from the persisted row.

## Custom tenant property

If the entity scopes by `organizationCode` rather than `tenantCode`, map it explicitly:

```ts
resolveResourceTenant: ({ resourceScope }) =>
  typeof resourceScope.organizationCode === 'string'
    ? resourceScope.organizationCode
    : undefined,
```

This fragment belongs in the `actionHistory` options. Missing or conflicting tenant attribution
fails before the resource mutation commits.

## Mount the read controller

```ts
import { Module } from '@nestjs/common';
import { ActionHistoryController } from '@sdcorejs/nestjs/features';

@Module({
  controllers: [ActionHistoryController],
})
export class HistoryHttpModule {}
```

The controller is not auto-mounted. It provides:

```http
GET /action-history/public.product/6e71382b-45e5-4f92-98f3-13bf48ae2f5e?pageNumber=0&pageSize=25
Authorization: Bearer <token>
```

The response is HTTP 200 with:

```json
{
  "data": {
    "items": [
      {
        "id": "history-uuid",
        "tenantCode": "ACME",
        "table": "public.product",
        "tableId": "6e71382b-45e5-4f92-98f3-13bf48ae2f5e",
        "type": "UPDATE",
        "fromData": { "name": "Old", "costPrice": "[REDACTED]" },
        "toData": { "name": "New", "costPrice": "[REDACTED]" },
        "createdAt": "2026-07-20T00:00:00.000Z"
      }
    ],
    "total": 1
  }
}
```

`history-uuid` is illustrative; persisted IDs are UUIDs. Missing, malformed, unauthorized, and
cross-tenant resources all return the same 404.

## Manual domain event

```ts
import { Injectable } from '@nestjs/common';
import {
  ActionHistoryService,
  ActionHistoryType,
} from '@sdcorejs/nestjs/features';

@Injectable()
class ApprovalAudit {
  constructor(private readonly history: ActionHistoryService) {}

  record(orderId: string, before: unknown, after: unknown) {
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

Manual `create()` requires a trusted tenant context. Prefer repository recording when history must
commit atomically with the domain row.

## Retention and security

`retentionDays` does not delete rows. Implement a separately approved compliance job. Built-in and
configured redaction runs before persistence, but it cannot identify every sensitive business
field; keep snapshots minimal and read policy resource-specific.
