import 'reflect-metadata';
import { ForbiddenException } from '@nestjs/common';
import { AuthGuard } from '../auth.guard';
import type { IPermissionStrategy } from '../strategy.interface';

type Req = { user?: unknown; permissions?: string[] };

function execCtx(req: Req) {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => function handler() {},
    getClass: () => class Cls {},
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function makeGuard(required: string[] | undefined, strategy: Partial<IPermissionStrategy>, ctx?: { set: jest.Mock; store?: unknown }) {
  const reflector = { getAllAndOverride: jest.fn(() => required) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const guard = new AuthGuard(reflector as any, strategy as IPermissionStrategy, ctx as any);
  // checkPermissions is protected — exercise it directly (canActivate's super() is passport auth, tested elsewhere).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { guard, check: (req: Req) => (guard as any).checkPermissions(execCtx(req)), reflector };
}

describe('AuthGuard.checkPermissions', () => {
  it('passes when the route has no @HasPermission metadata', async () => {
    const load = jest.fn();
    const { check } = makeGuard(undefined, { load });
    await expect(check({ user: { id: 'u1' } })).resolves.toBe(true);
    expect(load).not.toHaveBeenCalled();
  });

  it('passes on an empty required array', async () => {
    const { check } = makeGuard([], { load: jest.fn() });
    await expect(check({})).resolves.toBe(true);
  });

  it('loads codes and allows when the required permission is present', async () => {
    const ctx = { set: jest.fn(), store: { userId: 'u1' } };
    const load = jest.fn(async () => ['product:read']);
    const { check } = makeGuard(['product:read'], { load }, ctx);
    await expect(check({ user: { id: 'u1' } })).resolves.toBe(true);
    expect(load).toHaveBeenCalledWith({ userId: 'u1' });
    expect(ctx.set).toHaveBeenCalledWith('user', { id: 'u1' });
    expect(ctx.set).toHaveBeenCalledWith('permissions', ['product:read']);
  });

  it('throws ForbiddenException when the code is missing', async () => {
    const { check } = makeGuard(['product:write'], { load: async () => ['product:read'] });
    await expect(check({})).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('HasAnyPermission passes when ONE of the required codes matches', async () => {
    const { check } = makeGuard(['product:export', 'product:admin'], { load: async () => ['product:admin'] });
    await expect(check({})).resolves.toBe(true);
  });

  it('reuses req.permissions without re-loading (per-request cache)', async () => {
    const load = jest.fn(async () => ['x']);
    const { check } = makeGuard(['product:read'], { load });
    await check({ permissions: ['product:read'] });
    expect(load).not.toHaveBeenCalled();
  });

  it('honours a custom strategy.check (wildcard support)', async () => {
    const check = (codes: string[], required: string): boolean =>
      codes.some((c) => c === required || (c.endsWith(':*') && required.startsWith(c.slice(0, -1))));
    const { check: run } = makeGuard(['product:create'], { load: async () => ['product:*'], check });
    await expect(run({})).resolves.toBe(true);
  });
});
