import 'reflect-metadata';
import { type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '../../../src/auth/permission/auth.guard';
import { HasAnyPermission } from '../../../src/auth/permission/decorators/has-any-permission.decorator';
import { HasPermission } from '../../../src/auth/permission/decorators/has-permission.decorator';
import type { IPermissionStrategy } from '../../../src/auth/permission/strategy.interface';
import { ContextService } from '../../../src/core/context/context.service';

@Injectable()
class TestableAuthGuard extends AuthGuard {
  async canActivate(execCtx: ExecutionContext): Promise<boolean> {
    return this.checkPermissions(execCtx);
  }
}

const buildExecCtx = (handler: () => void, classRef: object, req: Record<string, unknown>): ExecutionContext =>
  ({
    getHandler: () => handler,
    getClass: () => classRef,
    switchToHttp: () => ({ getRequest: () => req }),
  }) as unknown as ExecutionContext;

const reflector = new Reflector();

describe('AuthGuard permission integration', () => {
  it('passes without loading when no permission metadata is present', async () => {
    const strategy: IPermissionStrategy = { load: jest.fn(async () => []) };
    class Controller {
      method(): void {
        return undefined;
      }
    }
    const guard = new TestableAuthGuard(reflector, strategy);
    await expect(guard.canActivate(buildExecCtx(Controller.prototype.method, Controller, { user: { sub: 'u1' } }))).resolves.toBe(true);
    expect(strategy.load).not.toHaveBeenCalled();
  });

  it('loads permissions once and stores them on the authenticated request', async () => {
    const strategy: IPermissionStrategy = { load: jest.fn(async () => ['product:create']) };
    class Controller {
      @HasPermission('product:create')
      method(): void {
        return undefined;
      }
    }
    const req: Record<string, unknown> = { user: { sub: 'u1' } };
    const guard = new TestableAuthGuard(reflector, strategy);

    await expect(guard.canActivate(buildExecCtx(Controller.prototype.method, Controller, req))).resolves.toBe(true);
    await expect(guard.canActivate(buildExecCtx(Controller.prototype.method, Controller, req))).resolves.toBe(true);
    expect(req.permissions).toEqual(['product:create']);
    expect(strategy.load).toHaveBeenCalledTimes(1);
  });

  it('throws a code-based ForbiddenException body on mismatch', async () => {
    const strategy: IPermissionStrategy = { load: async () => ['other:permission'] };
    class Controller {
      @HasPermission('product:create')
      method(): void {
        return undefined;
      }
    }
    const guard = new TestableAuthGuard(reflector, strategy);
    await expect(guard.canActivate(buildExecCtx(Controller.prototype.method, Controller, { user: { sub: 'u1' } }))).rejects.toMatchObject({
      response: {
        code: 'core.permission.forbidden',
        message: 'You do not have permission to perform this action',
        data: { required: ['product:create'] },
      },
    });
  });

  it('supports HasAnyPermission and a custom check function', async () => {
    const strategy: IPermissionStrategy = {
      load: async () => ['product:*'],
      check: (codes, required) =>
        codes.some((code) => code === '*:*' || code === required || (code.endsWith(':*') && required.startsWith(code.slice(0, -1)))),
    };
    class Controller {
      @HasAnyPermission('product:create', 'product:update')
      method(): void {
        return undefined;
      }
    }
    const guard = new TestableAuthGuard(reflector, strategy);
    await expect(guard.canActivate(buildExecCtx(Controller.prototype.method, Controller, { user: { sub: 'u1' } }))).resolves.toBe(true);
  });

  it('populates verified identity and resolved permissions in ContextService', async () => {
    const strategy: IPermissionStrategy = { load: async () => ['product:create'] };
    const context = new ContextService();
    class Controller {
      @HasPermission('product:create')
      method(): void {
        return undefined;
      }
    }
    const guard = new TestableAuthGuard(reflector, strategy, context);
    const principal = { sub: 'u1', tenant: 't1', roles: ['editor'], permissionVersion: 'pv1' };

    await context.run({}, async () => {
      await guard.canActivate(buildExecCtx(Controller.prototype.method, Controller, { user: principal }));
      expect(context.store).toMatchObject({
        userId: 'u1',
        tenant: 't1',
        roles: ['editor'],
        permissions: ['product:create'],
        permissionVersion: 'pv1',
        user: principal,
        identitySource: 'verified-principal',
      });
    });
  });

  it('rejects a verified JWT that conflicts with trusted gateway context', async () => {
    const strategy: IPermissionStrategy = { load: jest.fn(async () => []) };
    const context = new ContextService();
    class Controller {
      method(): void {
        return undefined;
      }
    }
    const guard = new TestableAuthGuard(reflector, strategy, context);

    await context.run({ tenant: 'trusted-tenant', identitySource: 'trusted-headers' }, async () => {
      await expect(
        guard.canActivate(buildExecCtx(Controller.prototype.method, Controller, { user: { sub: 'u1', tenant: 'different-tenant' } })),
      ).rejects.toMatchObject({ response: { code: 'core.context.identity-conflict' } });
    });
  });
});
