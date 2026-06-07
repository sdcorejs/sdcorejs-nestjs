import { type ExecutionContext, ForbiddenException, Inject, Injectable, Optional } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard as PassportAuthGuard } from '@nestjs/passport';
import { ContextService } from '../context/context.service';
import { apiError } from '../orm/types/api-response.types';
import type { IPermissionStrategy } from './strategy.interface';
import { PERMISSION_METADATA_KEY, PERMISSION_STRATEGY } from './tokens';

interface RequestWithPermissions {
  permissions?: string[];
  user?: unknown;
}

/**
 * JWT + permission guard. Extends `PassportAuthGuard('jwt')` so consumers register their
 * own `JwtStrategy` via `JwtModule.forRoot({ secret })`. After successful authentication,
 * loads permission codes via `IPermissionStrategy.load()` and validates the route's
 * `@HasPermission` / `@HasAnyPermission` metadata.
 *
 * Throws 403 with `apiError(code, message, data?)` body on permission mismatch — consumer's
 * i18n layer translates `code` to the localized message.
 */
@Injectable()
export class AuthGuard extends PassportAuthGuard('jwt') {
  constructor(
    private readonly reflector: Reflector,
    @Inject(PERMISSION_STRATEGY) private readonly strategy: IPermissionStrategy,
    @Optional() @Inject(ContextService) private readonly contextService?: ContextService,
  ) {
    super();
  }

  async canActivate(execCtx: ExecutionContext): Promise<boolean> {
    const authed = (await super.canActivate(execCtx)) as boolean;
    if (!authed) return false;
    return this.checkPermissions(execCtx);
  }

  protected async checkPermissions(execCtx: ExecutionContext): Promise<boolean> {
    const req = execCtx.switchToHttp().getRequest<RequestWithPermissions>();
    // Sync the authenticated user into the request context so downstream services see it
    // even on routes without a permission requirement.
    if (req.user !== undefined) this.contextService?.set('user', req.user);

    const required = this.reflector.getAllAndOverride<string[] | undefined>(PERMISSION_METADATA_KEY, [
      execCtx.getHandler(),
      execCtx.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    if (!req.permissions) {
      const ctx = this.contextService?.store ?? {};
      req.permissions = await this.strategy.load(ctx);
    }
    const codes = req.permissions ?? [];
    // Mirror resolved codes into the context so ContextService.hasPermission() works downstream.
    this.contextService?.set('permissions', codes);
    const check = this.strategy.check ?? ((cs: string[], r: string): boolean => cs.includes(r));
    const allowed = required.some((r) => check(codes, r));
    if (!allowed) {
      throw new ForbiddenException(
        apiError('core.permission.forbidden', 'You do not have permission to perform this action', {
          required,
        }),
      );
    }
    return true;
  }
}
