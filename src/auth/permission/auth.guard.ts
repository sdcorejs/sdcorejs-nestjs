import { type ExecutionContext, ForbiddenException, Inject, Injectable, Optional, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard as PassportAuthGuard } from '@nestjs/passport';
import type { IncomingMessage } from 'node:http';
import { ContextService } from '../../core/context/context.service';
import { defaultVerifiedPrincipalResolver, normalizeContextIdentity } from '../../core/context/identity.resolver';
import { CONTEXT_IDENTITY_CONFIG } from '../../core/context/tokens';
import type { RequestContext, ResolvedContextIdentity, ResolvedContextIdentityOptions } from '../../core/context/types';
import { apiError } from '../../core/orm/types/api-response.types';
import type { IPermissionStrategy } from './strategy.interface';
import { PERMISSION_METADATA_KEY, PERMISSION_STRATEGY } from './tokens';

const RESOLVED_PERMISSIONS_FOR = Symbol('sdcore:permission:resolved-for');
const TRUSTED_REQUEST_IDENTITY = Symbol('sdcore:context:trusted-request-identity');

interface RequestWithPermissions extends IncomingMessage {
  permissions?: string[];
  user?: unknown;
  [RESOLVED_PERMISSIONS_FOR]?: string;
  [TRUSTED_REQUEST_IDENTITY]?: Partial<ResolvedContextIdentity>;
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
    @Optional() @Inject(CONTEXT_IDENTITY_CONFIG) private readonly identityConfig?: ResolvedContextIdentityOptions,
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
    const identity = await this.syncVerifiedIdentity(req);

    const required = this.reflector.getAllAndOverride<string[] | undefined>(PERMISSION_METADATA_KEY, [
      execCtx.getHandler(),
      execCtx.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    if (!req.permissions) {
      const ctx = this.contextService?.store ?? {};
      req.permissions = await this.strategy.load(ctx);
      req[RESOLVED_PERMISSIONS_FOR] = identity.userId;
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

  private async syncVerifiedIdentity(req: RequestWithPermissions): Promise<ResolvedContextIdentity> {
    if (req.user === undefined) {
      throw new UnauthorizedException(apiError('core.context.verified-principal-missing', 'Verified principal is required'));
    }

    let verified: ResolvedContextIdentity;
    try {
      const resolver = this.identityConfig?.principalResolver ?? defaultVerifiedPrincipalResolver;
      verified = normalizeContextIdentity(await resolver(req.user, req), true);
    } catch {
      throw new UnauthorizedException(
        apiError('core.context.verified-principal-invalid', 'Verified principal could not be mapped to request identity'),
      );
    }

    const current = this.contextService?.store;
    if (current?.identitySource === 'trusted-headers') req[TRUSTED_REQUEST_IDENTITY] = this.pickIdentity(current);
    const trusted = req[TRUSTED_REQUEST_IDENTITY];
    if (trusted && this.hasConflict(trusted, verified)) {
      throw new UnauthorizedException(
        apiError('core.context.identity-conflict', 'Verified principal conflicts with trusted gateway identity'),
      );
    }

    const identity: ResolvedContextIdentity = {
      userId: verified.userId,
      tenant: verified.tenant ?? trusted?.tenant,
      roles: verified.roles ?? trusted?.roles,
      permissions:
        verified.permissions ?? trusted?.permissions ?? (req[RESOLVED_PERMISSIONS_FOR] === verified.userId ? req.permissions : undefined),
      permissionVersion: verified.permissionVersion ?? trusted?.permissionVersion,
      custom: trusted?.custom || verified.custom ? { ...(trusted?.custom ?? {}), ...(verified.custom ?? {}) } : undefined,
    };
    this.contextService?.setIdentity(identity, 'verified-principal', req.user);
    if (identity.permissions !== undefined) {
      req.permissions = [...identity.permissions];
      req[RESOLVED_PERMISSIONS_FOR] = identity.userId;
    } else if (req[RESOLVED_PERMISSIONS_FOR] !== identity.userId) {
      delete req.permissions;
      delete req[RESOLVED_PERMISSIONS_FOR];
    }
    return identity;
  }

  private pickIdentity(ctx: RequestContext): Partial<ResolvedContextIdentity> {
    return {
      userId: ctx.userId,
      tenant: ctx.tenant,
      roles: ctx.roles ? [...ctx.roles] : undefined,
      permissions: ctx.permissions ? [...ctx.permissions] : undefined,
      permissionVersion: ctx.permissionVersion,
      custom: ctx.custom ? { ...ctx.custom } : undefined,
    };
  }

  private hasConflict(trusted: Partial<ResolvedContextIdentity>, verified: ResolvedContextIdentity): boolean {
    const scalars: Array<keyof Pick<ResolvedContextIdentity, 'userId' | 'tenant' | 'permissionVersion'>> = [
      'userId',
      'tenant',
      'permissionVersion',
    ];
    if (scalars.some((key) => trusted[key] !== undefined && verified[key] !== undefined && trusted[key] !== verified[key])) {
      return true;
    }
    return (
      this.arraysConflict(trusted.roles, verified.roles) ||
      this.arraysConflict(trusted.permissions, verified.permissions) ||
      this.customConflict(trusted.custom, verified.custom)
    );
  }

  private arraysConflict(left?: string[], right?: string[]): boolean {
    if (left === undefined || right === undefined) return false;
    return JSON.stringify([...left].sort()) !== JSON.stringify([...right].sort());
  }

  private customConflict(left?: Record<string, unknown>, right?: Record<string, unknown>): boolean {
    if (!left || !right) return false;
    try {
      return Object.keys(left).some(
        (key) => Object.prototype.hasOwnProperty.call(right, key) && !this.safeIdentityValueEqual(left[key], right[key]),
      );
    } catch {
      return true;
    }
  }

  /** Compare overlapping custom identity claims without invoking getters or accepting cycles. */
  private safeIdentityValueEqual(left: unknown, right: unknown, ancestors = new WeakSet<object>(), depth = 0): boolean {
    if (depth > 32 || typeof left !== typeof right) return false;
    if (left === null || right === null || left === undefined || right === undefined) return left === right;
    if (typeof left === 'string' || typeof left === 'boolean') return left === right;
    if (typeof left === 'number')
      return typeof right === 'number' && Number.isFinite(left) && Number.isFinite(right) && Object.is(left, right);
    if (typeof left !== 'object' || typeof right !== 'object') return false;
    if (ancestors.has(left) || ancestors.has(right)) return false;
    ancestors.add(left);
    ancestors.add(right);
    try {
      if (Array.isArray(left) || Array.isArray(right)) {
        if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
        return left.every((value, index) => this.safeIdentityValueEqual(value, right[index], ancestors, depth + 1));
      }
      if (
        (Object.getPrototypeOf(left) !== Object.prototype && Object.getPrototypeOf(left) !== null) ||
        (Object.getPrototypeOf(right) !== Object.prototype && Object.getPrototypeOf(right) !== null)
      ) {
        return false;
      }
      const leftKeys = Object.keys(left as Record<string, unknown>).sort();
      const rightKeys = Object.keys(right as Record<string, unknown>).sort();
      if (leftKeys.length !== rightKeys.length || leftKeys.some((key, index) => key !== rightKeys[index])) return false;
      return leftKeys.every((key) => {
        const leftProperty = Object.getOwnPropertyDescriptor(left, key);
        const rightProperty = Object.getOwnPropertyDescriptor(right, key);
        return (
          leftProperty?.enumerable === true &&
          rightProperty?.enumerable === true &&
          'value' in leftProperty &&
          'value' in rightProperty &&
          this.safeIdentityValueEqual(leftProperty.value, rightProperty.value, ancestors, depth + 1)
        );
      });
    } finally {
      ancestors.delete(left);
      ancestors.delete(right);
    }
  }
}
