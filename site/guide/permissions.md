# Permissions

Permission codes are resolved by **your** `IPermissionStrategy.load(ctx)` once per request and cached.
`AuthGuard` reads the route's `@HasPermission` / `@HasAnyPermission` metadata and enforces it.

```ts
import { Injectable } from '@nestjs/common';
import type { IPermissionStrategy } from '@sdcorejs/nestjs/auth';
import type { RequestContext } from '@sdcorejs/nestjs/core';

@Injectable()
export class AppPermissionStrategy implements IPermissionStrategy {
  constructor(private readonly pages: PagePermissionService) {}

  async load(ctx: RequestContext): Promise<string[]> {
    return this.pages.codesForUser(ctx.userId);
  }

  // Optional — override the default `Array.includes` to support wildcards / hierarchy.
  check(codes: string[], required: string): boolean {
    return codes.some((c) => c === required || (c.endsWith(':*') && required.startsWith(c.slice(0, -1))));
  }
}
```

Register it via `SdCoreModule.forRoot({ permission: { strategy: AppPermissionStrategy } })`.

## Protect routes

```ts
import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard, HasPermission, HasAnyPermission } from '@sdcorejs/nestjs/auth';

@Controller('products')
@UseGuards(AuthGuard)
export class ProductController {
  @Get()
  @HasPermission('product:read')
  list() { /* ... */ }

  @Get('export')
  @HasAnyPermission('product:export', 'product:admin')
  export() { /* ... */ }
}
```

`AuthGuard` syncs the authenticated `user` and the resolved `permissions` into `ContextService`, so any
downstream service can call `contextService.hasPermission('product:read')` without re-loading.
