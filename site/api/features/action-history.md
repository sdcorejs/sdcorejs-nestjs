# Action history API

Import path: `@sdcorejs/nestjs/features`

Action history stores tenant-scoped before/after snapshots for resource changes. It can be called
directly or registered as the history recorder used by `BaseRepository({ logHistory: true })`.

## Exports

| Export | Kind | Purpose |
| --- | --- | --- |
| `ActionHistory` | entity class | `action-history` PostgreSQL row |
| `ActionHistoryType` | enum | `CREATE`, `UPDATE`, `DELETE` |
| `ActionHistorySaveReq<T>` | interface | Manual write request |
| `ActionHistoryDTO<T>` | interface | Serialized row |
| `ActionHistoryActor`, `ActionHistoryActorResolver` | types | Per-request actor mapping |
| `ACTION_HISTORY_ACTOR_RESOLVER` | value | Actor resolver DI token |
| `ActionHistoryQuery`, `ActionHistoryPage<T>` | interfaces | Bounded resource query/result |
| `ActionHistoryAuthorizationRequest`, `ActionHistoryAuthorizationPolicy` | types | Mandatory read policy input/callback |
| `ActionHistorySnapshotRedactor` | type | Optional pre-redaction transform |
| `ActionHistoryResourceTenantRequest`, `ActionHistoryResourceTenantResolver` | types | Persisted resource scope to tenant mapping |
| `ActionHistorySecurityOptions` | interface | Read, redaction, tenant, page and retention policy |
| `ACTION_HISTORY_SECURITY_OPTIONS` | value | Security policy DI token |
| `ActionHistoryService` | class | `create`, `record`, and `all` API |
| `ActionHistoryModule`, `ActionHistoryModuleOptions` | class/type | Feature and recorder registration |
| `ActionHistoryController` | class | Optional authenticated read endpoint |
| `MissingActionHistoryTenantError` | class | Manual write has no trusted tenant |
| `MissingActionHistoryResourceTenantError` | class | Persisted scope cannot map safely to one tenant |
| `ActionHistorySnapshotLimitError` | class | Snapshot exceeds defensive limits |
| `ActionHistoryUnsafeSnapshotError` | class | Snapshot contains accessors or prototype-sensitive properties |

## Entity and module setup

```ts
TypeOrmModule.forRoot({
  type: 'postgres',
  // ...
  entities: [ActionHistory, Product],
});

ActionHistoryModule.forRoot({
  authorizeRead: ({ context, tenantCode, table, tableId }) =>
    context.tenant === tenantCode &&
    context.permissions?.includes(`${table}:history:read`) === true,
  resolveActor: (ctx) => ({
    userId: ctx.userId,
    username: ctx.getCustom<string>('username'),
    fullName: ctx.getCustom<string>('fullName'),
  }),
  redactFields: ['payment.cardNumber'],
  maxPageSize: 100,
  retentionDays: 365,
});
```

Add `ActionHistory` to the datasource. The entity uses a PostgreSQL enum, UUIDs and JSONB snapshots.
`global` and `registerAsHistoryRecorder` both default to `true`. `retentionDays` is an operations
hint only; the library never deletes history automatically.

## Automatic repository history

```ts
export class ProductRepository extends BaseRepository<Product> {
  constructor(dataSource: DataSource) {
    super(Product, dataSource, { logHistory: true });
  }
}
```

Repository create/update/hard-delete emits a `HistoryEntry` in the same transaction. The stable
resource type is TypeORM `EntityMetadata.tablePath`, including schema. For scoped entities, tenant
attribution comes from scope values selected from the persisted row—not DTO/request input.

The default mapping reads `resourceScope.tenantCode`. If an entity uses another tenant property,
configure a synchronous `resolveResourceTenant`:

```ts
resolveResourceTenant: ({ resourceScope }) =>
  typeof resourceScope.organizationId === 'string'
    ? resourceScope.organizationId
    : undefined,
```

If the default `tenantCode` and custom resolver both produce different values, the write fails. An
unmappable scoped resource also fails before commit.

## Manual writes

```ts
await history.create({
  table: 'public.product',
  tableId: product.id,
  type: ActionHistoryType.UPDATE,
  fromData: before,
  toData: after,
  note: 'Price corrected',
});
```

Manual `create` takes tenant from `ContextService.tenant`, falling back to
`ContextService.custom.tenantCode`, and throws `MissingActionHistoryTenantError` if neither is a
nonblank string. An optional `QueryRunner` writes through that transaction.

`record(entry: HistoryEntry)` is the `IHistoryRecorder` method used by repositories.

## Read API

```ts
const page = await history.all({
  table: 'public.product',
  tableId: product.id,
  pageNumber: 0,
  pageSize: 50,
});
```

Pages are zero-based. The default configured maximum is 100; finite configuration is clamped to
`1..200`. Request size is clamped to that maximum and the database offset is capped at 100,000.
Results sort newest first and return `{ items, total }`.

Read access is denied unless `authorizeRead` returns exactly `true`. Missing tenant, invalid query,
policy deny/exception and missing data all produce 404 `core.history.not-found`, preventing resource
enumeration. The SQL predicate includes tenant, table and table ID.

## Snapshot redaction and limits

The optional `redactSnapshot(snapshot, context)` transform runs first. The mandatory recursive
redactor then replaces configured paths and common secret-like field names (password, secret,
token, authorization, API/private/access keys and credentials) with `[REDACTED]`. Matching is
case-insensitive and recognizes compound key names. Cycles are redacted; `Date` becomes ISO text.

Fixed defensive ceilings are 32 levels, 10,000 nodes and 1 MiB of counted UTF-8 snapshot/path text.
Exceeding a ceiling throws `ActionHistorySnapshotLimitError` before persistence. Do not use a custom
transform to reintroduce secrets; mandatory redaction always runs afterward. Enumerable accessors,
symbol keys and prototype-sensitive keys such as `__proto__`, `prototype` or `constructor` throw
`ActionHistoryUnsafeSnapshotError` before a getter can run or the snapshot can be persisted.

## Optional controller

`ActionHistoryController` is not auto-registered. Add it to an application module:

```text
GET /action-history/:table/:tableId?pageNumber=0&pageSize=100
```

It applies `AuthGuard`, wraps the page in `ApiResponse.ok`, and still relies on service-level
`authorizeRead`. If your `tablePath` contains characters requiring URL escaping, encode the route
segment or provide an application-specific controller.

## Security notes

- Read policy is mandatory; omission means deny all.
- Snapshot history is sensitive. Apply field redaction, database access controls and explicit
  retention outside the library.
- The row is an audit trail, not cryptographic tamper evidence. Use an append-only external sink if
  you require immutability guarantees.
