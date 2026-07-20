# Audit API

Import path: `@sdcorejs/nestjs/core`

The audit layer fills actor columns on `WithAudit` entities. It is separate from the persisted
[action-history feature](../features/action-history.md), which stores before/after snapshots.

## Exports

| Export | Kind | Purpose |
| --- | --- | --- |
| `IAuditStrategy` | interface | `onCreate`, `onUpdate`, `onSoftDelete` hooks |
| `AUDIT_STRATEGY` | value | Strategy DI token |
| `DefaultAuditStrategy` | class | Fills actor UUIDs from `RequestContext.userId` |
| `AuditSubscriber` | class | TypeORM lifecycle subscriber for `WithAudit` entities |
| `AuditModule`, `AuditModuleOptions` | class/type | Registers the strategy and subscriber provider |

Related ORM exports are `WithAudit`, `WithTimestamps`, `isAuditEnabled`, `UserSnapshot` and
`BaseRepositoryOptions.auditStrategy`.

## Strategy contract

```ts
interface IAuditStrategy {
  onCreate(entity: DeepPartial<any>, ctx: RequestContext): void;
  onUpdate(entity: DeepPartial<any>, ctx: RequestContext): void;
  onSoftDelete(entity: DeepPartial<any>, ctx: RequestContext): void;
}
```

```ts
@Injectable()
export class AppAuditStrategy implements IAuditStrategy {
  onCreate(entity: any, ctx: RequestContext): void {
    if (!ctx.userId) return;
    entity.createdBy ??= ctx.userId;
    entity.modifiedBy ??= ctx.userId;
    const actor = ctx.custom?.actorSnapshot as UserSnapshot | undefined;
    if (actor) {
      entity.creator ??= actor;
      entity.modifier ??= actor;
    }
  }

  onUpdate(entity: any, ctx: RequestContext): void {
    if (ctx.userId) entity.modifiedBy = ctx.userId;
  }

  onSoftDelete(): void {}
}

AuditModule.forRoot({ strategy: AppAuditStrategy });
```

Hooks are synchronous. `DefaultAuditStrategy` silently skips anonymous operations, sets
`createdBy`/`modifiedBy`, and does not populate JSON snapshots.

## Register the TypeORM subscriber

`AuditModule` provides `AuditSubscriber`, but cannot mutate your datasource configuration. Attach
the DI-created instance once during bootstrap:

```ts
const subscriber = app.get(AuditSubscriber);
const dataSource = app.get(DataSource);

if (!dataSource.subscribers.includes(subscriber)) {
  dataSource.subscribers.push(subscriber);
}
```

The subscriber acts only on `WithAudit` entities. On insert it skips a row whose `createdBy` is
already present, which avoids double-filling when `BaseRepository.create` has run the strategy
directly.

## Repository integration

Pass `auditStrategy` to a concrete `BaseRepository` when you need repository hooks independent of
the TypeORM subscriber:

```ts
super(Product, dataSource, {
  auditStrategy,
  contextService,
});
```

Repository create/update hooks run before persistence. The repository applies tenancy write scope
after the create audit hook and rejects any scope field introduced by the update audit hook.

## Security notes

- Actor values must come from verified request identity, not raw headers or DTO fields.
- Avoid serializing the full `ctx.user` object into `creator`/`modifier`; map an explicit bounded
  snapshot and redact credentials/tokens.
- `AuditSubscriber` does not create a tamper-evident event log. Use action history or an external
  append-only audit sink where that property is required.
