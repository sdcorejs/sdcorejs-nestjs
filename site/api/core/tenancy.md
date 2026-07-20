# Multi-tenancy API

Import path: `@sdcorejs/nestjs/core`

Tenancy is metadata- and strategy-driven. Any entity property decorated with `@Scoped()` becomes a
mandatory query/write boundary enforced by `BaseRepository`. Unscoped entities are unchanged.

## Exports

| Export | Kind | Purpose |
| --- | --- | --- |
| `ITenancyStrategy` | interface | Resolves scope and optional privileged grants |
| `TenancyOperation` | type | `read`, `create`, `import`, `update`, `delete`, `soft-delete`, `restore` |
| `TENANCY_OPERATIONS` | readonly tuple | Complete runtime operation allowlist |
| `TenancyBypassGrant`, `TenancyBypassAuditEvent` | interfaces | Bounded privileged access and audit event |
| `TenancyCallbacks` | interface | Inline `resolve`, deprecated `bypass`, and `bypassGrant` callbacks |
| `DefaultTenancyStrategy` | class | Empty-scope, never-bypass default |
| `CallbackTenancyStrategy` | class | Adapts callbacks to `ITenancyStrategy` |
| `TenancyModule`, `TenancyModuleOptions` | class/type | Strategy registration module |
| `TENANCY_STRATEGY` | value | DI token |
| `buildScopeFilters` | function | Builds `Filter[]` predicates |
| `buildScopeWhere` | function | Builds TypeORM criteria predicates |
| `applyScopeToEntity` | function | Validates and applies write scope |
| `RegisteredTenancy` | interface | Process-wide strategy/context binding |
| `registerTenancy`, `getTenancy` | functions | Process-wide registry API |
| `TenancyError` | class | Base coded tenancy error |
| `MissingTenancyContextError` | class | Scoped entity has no strategy |
| `MissingTenancyScopeError` | class | Required scope dimension is absent |
| `InvalidTenancyScopeError` | class | Scope value is unsafe/invalid |
| `TenancyScopeMutationError` | class | Update tries to move a row between scopes |
| `UnauthorizedTenancyBypassError` | class | Bypass grant is absent, malformed or unauthorized |

The `Scoped`, `ScopedOptions`, `ScopedColumnMetadata`, `getScopedColumns`, and
`getScopedColumnMetadata` exports are documented with the [ORM decorators](./orm.md#entity-and-metadata-exports).

## Strategy example

```ts
import type { RequestContext } from '@sdcorejs/nestjs';
import {
  type ITenancyStrategy,
  TenancyModule,
  type TenancyBypassGrant,
} from '@sdcorejs/nestjs/core';

export class AppTenancyStrategy implements ITenancyStrategy {
  getCurrentScope(ctx: RequestContext): Record<string, unknown> {
    return {
      tenantCode: ctx.tenant,
      departmentCode: ctx.custom?.departmentCode,
    };
  }

  shouldBypass(): boolean {
    return false;
  }

  getBypassGrant(ctx: RequestContext): TenancyBypassGrant | undefined {
    if (!ctx.roles?.includes('platform-admin') || !ctx.userId) return undefined;
    return {
      authorized: true,
      actorId: ctx.userId,
      reason: 'approved cross-tenant support request',
      allowedTargets: ['public.product'],
      allowedOperations: ['read'],
      audit: (event) => privilegedAuditSink.writeSync(event),
    };
  }
}

TenancyModule.forRoot({ strategy: AppTenancyStrategy });
```

`getCurrentScope` keys are entity **property names**, not database column names. Scalars become
`EQUAL`; arrays become `IN`. Missing optional scopes are omitted. A required scope with no value
fails closed. An empty allowed-value array matches zero rows.

For writes, scalar scope overwrites caller input. With multiple allowed values, the caller must
select one of them on the new entity; a single allowed value is selected automatically.

## Inline configuration

```ts
TenancyModule.forRoot({
  resolve: (ctx) => ({ tenantCode: ctx.tenant }),
  global: true,
  registerGlobally: true,
});
```

`global` and `registerGlobally` both default to `true`. A strategy class takes precedence over
inline callbacks. The registry uses a `Symbol.for` slot so repositories loaded through different
package subpaths still observe the same binding.

## Privileged bypass

A bypass grant must have `authorized: true`, non-empty actor/reason, at least one exact
`EntityMetadata.tablePath` (or `*`), at least one valid operation, and a synchronous `audit`
callback. The callback must return `undefined`; promises/thenables fail closed because the
repository cannot guarantee an asynchronous audit completes before issuing SQL.

The legacy `shouldBypass() === true` path is deliberately rejected. Keep the method for interface
compatibility, but return `false` and implement `getBypassGrant` for reviewed privileged flows.

## Error codes

| Error | `code` |
| --- | --- |
| `MissingTenancyContextError` | `TENANCY_CONTEXT_MISSING` |
| `MissingTenancyScopeError` | `TENANCY_SCOPE_MISSING` |
| `InvalidTenancyScopeError` | `TENANCY_SCOPE_INVALID` |
| `TenancyScopeMutationError` | `TENANCY_SCOPE_IMMUTABLE` |
| `UnauthorizedTenancyBypassError` | `TENANCY_BYPASS_UNAUTHORIZED` |

These are application errors rather than automatic HTTP envelopes. Map them at your boundary
without exposing cross-tenant resource existence.
