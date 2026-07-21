# Permissions

`AuthGuard` performs two steps: Passport verifies the `jwt` strategy, then the configured
`IPermissionStrategy` loads and checks route permissions. The default strategy returns no
permissions, so decorated routes deny access until the application supplies policy.

## Implement a permission strategy

```ts
import { Injectable } from '@nestjs/common';
import type { IPermissionStrategy } from '@sdcorejs/nestjs/auth';
import type { RequestContext } from '@sdcorejs/nestjs/core';

@Injectable()
export class AppPermissionStrategy implements IPermissionStrategy {
  async load(context: RequestContext): Promise<string[]> {
    if (!context.userId || !context.tenant) return [];

    // Replace this line with your repository/authorization service.
    return ['tenant:' + context.tenant + ':product:read'];
  }

  check(codes: string[], required: string): boolean {
    return codes.includes(required) ||
      codes.some((code) =>
        code.endsWith(':*') && required.startsWith(code.slice(0, -1)),
      );
  }
}
```

Register the class:

```ts
import { SdCoreModule } from '@sdcorejs/nestjs';

SdCoreModule.forRoot({
  permission: { strategy: AppPermissionStrategy },
});
```

`load()` is called at most once per request when permission metadata is present. The resulting
codes are mirrored to `ContextService.permissions`, so downstream code can call
`context.hasPermission(code)`.

## Protect routes

```ts
import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  AuthGuard,
  HasAnyPermission,
  HasPermission,
} from '@sdcorejs/nestjs/auth';

@Controller('products')
@UseGuards(AuthGuard)
export class ProductQueryController {
  @Get()
  @HasPermission('product:read')
  list() {
    return [];
  }

  @Get('export')
  @HasAnyPermission('product:export', 'product:admin')
  exportRows() {
    return [];
  }
}
```

`HasAnyPermission` is OR semantics. Handler metadata overrides class metadata because the guard
uses Nest's `getAllAndOverride`; repeat class-level requirements on an overridden handler when
that is your intended policy.

## Identity and status behavior

- Missing, invalid, or expired JWT: Passport returns 401.
- A verified principal that cannot map to a valid `userId`: 401.
- Conflict between verified JWT identity and trusted-gateway identity: 401.
- Missing required permission: 403 with code `core.permission.forbidden`.

Run validation after authentication:

```ts
import { Controller, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@sdcorejs/nestjs/auth';
import { ZodValidationGuard } from '@sdcorejs/nestjs/validation';
import { z } from 'zod';

const CreateProductSchema = z.object({ name: z.string().min(1) });

@Controller('products')
export class CreateProductController {
  @Post()
  @UseGuards(AuthGuard, ZodValidationGuard(CreateProductSchema))
  create() {
    return { accepted: true };
  }
}
```

The ordering prevents validation details from being exposed to unauthenticated callers.

## Cache interaction

The user and tenant cache scopes fingerprint permissions and roles. If your authorization backend
can change permissions during a token/session lifetime, set a stable `permissionVersion` in the
resolved identity and update it whenever permission state changes.
