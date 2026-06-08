# Request context

`ContextService` is an `AsyncLocalStorage`-backed singleton — per-request isolation without
request-scoped DI. `ContextMiddleware` populates it from headers.

| Accessor | Source |
|---|---|
| `userId` | `x-user-id` header / JWT |
| `tenant` | `x-tenant` header |
| `lang` | `accept-language` / `x-language` (raw string; consumer parses to a locale) |
| `token`, `user`, `permissions` | filled by `AuthGuard` after JWT validation |
| `hasPermission(code)` | checks the synced `permissions` set |
| `getCustom<T>(key)` | reads a consumer value from `ctx.custom` |

The library keeps only framework-generic keys. Domain values go in `ctx.custom`, or add typed fields via
declaration merging:

```ts
declare module '@sdcorejs/nestjs/core' {
  interface RequestContext {
    departmentCode?: string;
    isSystemAdmin?: boolean;
  }
}
```

Configure which headers populate the context via
`SdCoreModule.forRoot({ context: { headers: { tenant: 'x-tenant', userId: 'x-user-id' } } })`.
