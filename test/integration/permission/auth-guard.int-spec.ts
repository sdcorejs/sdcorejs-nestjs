import 'reflect-metadata';
import { type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '../../../src/auth/permission/auth.guard';
import { HasPermission } from '../../../src/auth/permission/decorators/has-permission.decorator';
import { HasAnyPermission } from '../../../src/auth/permission/decorators/has-any-permission.decorator';
import type { IPermissionStrategy } from '../../../src/auth/permission/strategy.interface';
import { ContextService } from '../../../src/core/context/context.service';

// Stub guard that bypasses passport-jwt — exercises only the permission check pipeline.
@Injectable()
class TestableAuthGuard extends AuthGuard {
  async canActivate(execCtx: ExecutionContext): Promise<boolean> {
    return this.checkPermissions(execCtx);
  }
}

const buildExecCtx = (handler: () => void, classRef: object, req: Record<string, unknown> = {}): ExecutionContext =>
  ({
    getHandler: () => handler,
    getClass: () => classRef,
    switchToHttp: () => ({ getRequest: () => req }),
  }) as unknown as ExecutionContext;

const reflector = new Reflector();

describe('AuthGuard permission check', () => {
  it('passes when no @HasPermission metadata present', async () => {
    const strategy: IPermissionStrategy = { load: jest.fn(async () => []) };
    class C {
      m() {}
    }
    const guard = new TestableAuthGuard(reflector, strategy);
    const result = await guard.canActivate(buildExecCtx(C.prototype.m, C));
    expect(result).toBe(true);
    expect(strategy.load).not.toHaveBeenCalled();
  });

  it('loads codes from strategy + caches on request.permissions', async () => {
    const strategy: IPermissionStrategy = { load: jest.fn(async () => ['product:create']) };
    class C {
      @HasPermission('product:create')
      m() {}
    }
    const req: Record<string, unknown> = {};
    const guard = new TestableAuthGuard(reflector, strategy);
    const ok = await guard.canActivate(buildExecCtx(C.prototype.m, C, req));
    expect(ok).toBe(true);
    expect(req.permissions).toEqual(['product:create']);
    expect(strategy.load).toHaveBeenCalledTimes(1);

    // Second call uses cache
    await guard.canActivate(buildExecCtx(C.prototype.m, C, req));
    expect(strategy.load).toHaveBeenCalledTimes(1);
  });

  it('throws ForbiddenException with code-based body on mismatch', async () => {
    const strategy: IPermissionStrategy = { load: async () => ['other:permission'] };
    class C {
      @HasPermission('product:create')
      m() {}
    }
    const guard = new TestableAuthGuard(reflector, strategy);
    await expect(guard.canActivate(buildExecCtx(C.prototype.m, C))).rejects.toMatchObject({
      response: {
        code: 'core.permission.forbidden',
        message: 'You do not have permission to perform this action',
        data: { required: ['product:create'] },
      },
    });
  });

  it('@HasAnyPermission passes if any code matches', async () => {
    const strategy: IPermissionStrategy = { load: async () => ['product:update'] };
    class C {
      @HasAnyPermission('product:create', 'product:update')
      m() {}
    }
    const guard = new TestableAuthGuard(reflector, strategy);
    const ok = await guard.canActivate(buildExecCtx(C.prototype.m, C));
    expect(ok).toBe(true);
  });

  it('syncs loaded permissions into ContextService', async () => {
    const strategy: IPermissionStrategy = { load: async () => ['product:create'] };
    const ctx = new ContextService();
    class C {
      @HasPermission('product:create')
      m() {}
    }
    const guard = new TestableAuthGuard(reflector, strategy, ctx);
    await ctx.run({}, async () => {
      await guard.canActivate(buildExecCtx(C.prototype.m, C, {}));
      expect(ctx.permissions).toEqual(['product:create']);
      expect(ctx.hasPermission('product:create')).toBe(true);
    });
  });

  it('syncs authenticated user into ContextService', async () => {
    const strategy: IPermissionStrategy = { load: async () => [] };
    const ctx = new ContextService();
    class C {
      m() {}
    }
    const guard = new TestableAuthGuard(reflector, strategy, ctx);
    const req = { user: { id: 'u1', email: 'a@b.c' } };
    await ctx.run({}, async () => {
      await guard.canActivate(buildExecCtx(C.prototype.m, C, req));
      expect(ctx.user).toEqual({ id: 'u1', email: 'a@b.c' });
    });
  });

  it('custom check function overrides default Array.includes', async () => {
    const strategy: IPermissionStrategy = {
      load: async () => ['product:*'],
      check: (codes, required) =>
        codes.some((c) => c === '*:*' || c === required || (c.endsWith(':*') && required.startsWith(c.slice(0, -1)))),
    };
    class C {
      @HasPermission('product:delete')
      m() {}
    }
    const guard = new TestableAuthGuard(reflector, strategy);
    const ok = await guard.canActivate(buildExecCtx(C.prototype.m, C));
    expect(ok).toBe(true);
  });
});
