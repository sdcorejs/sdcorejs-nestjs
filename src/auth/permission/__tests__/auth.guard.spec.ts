import 'reflect-metadata';
import { ForbiddenException, type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { ContextService } from '../../../core/context/context.service';
import type { RequestContext, ResolvedContextIdentityOptions } from '../../../core/context/types';
import { AuthGuard } from '../auth.guard';
import type { IPermissionStrategy } from '../strategy.interface';

type Req = Record<string, unknown> & { user?: unknown; permissions?: string[] };

const execCtx = (req: Req): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () =>
      function handler() {
        return undefined;
      },
    getClass: () => class Cls {},
  }) as unknown as ExecutionContext;

function makeGuard(
  required: string[] | undefined,
  strategy: Partial<IPermissionStrategy>,
  context?: ContextService,
  identity?: ResolvedContextIdentityOptions,
) {
  const reflector = { getAllAndOverride: jest.fn(() => required) } as unknown as Reflector;
  const guard = new AuthGuard(reflector, strategy as IPermissionStrategy, context, identity);
  const exposed = guard as unknown as { checkPermissions(context: ExecutionContext): Promise<boolean> };
  return { check: (req: Req) => exposed.checkPermissions(execCtx(req)), reflector };
}

describe('AuthGuard.checkPermissions', () => {
  it('passes without loading permissions when the route has no permission metadata', async () => {
    const load = jest.fn();
    const { check } = makeGuard(undefined, { load });
    await expect(check({ user: { id: 'u1' } })).resolves.toBe(true);
    expect(load).not.toHaveBeenCalled();
  });

  it('passes on an empty required array after resolving the verified principal', async () => {
    const { check } = makeGuard([], { load: jest.fn() });
    await expect(check({ user: { sub: 'u1' } })).resolves.toBe(true);
  });

  it('loads codes against verified context and mirrors them downstream', async () => {
    const context = new ContextService();
    const load = jest.fn(async () => ['product:read']);
    const { check } = makeGuard(['product:read'], { load }, context);
    const principal = { sub: 'u1', tenant: 't1', roles: ['reader'], permissionVersion: 'v1' };

    await context.run({}, async () => {
      await expect(check({ user: principal })).resolves.toBe(true);
      expect(load).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', tenant: 't1', roles: ['reader'] }));
      expect(context.store).toMatchObject({
        userId: 'u1',
        tenant: 't1',
        roles: ['reader'],
        permissions: ['product:read'],
        permissionVersion: 'v1',
        identitySource: 'verified-principal',
        user: principal,
      });
    });
  });

  it('throws ForbiddenException when the verified user lacks the required code', async () => {
    const { check } = makeGuard(['product:write'], { load: async () => ['product:read'] });
    await expect(check({ user: { id: 'u1' } })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows HasAnyPermission when one required code matches', async () => {
    const { check } = makeGuard(['product:export', 'product:admin'], { load: async () => ['product:admin'] });
    await expect(check({ user: { id: 'u1' } })).resolves.toBe(true);
  });

  it('does not trust caller-populated req.permissions', async () => {
    const load = jest.fn(async () => ['safe:read']);
    const { check } = makeGuard(['admin:all'], { load });
    await expect(check({ user: { id: 'u1' }, permissions: ['admin:all'] })).rejects.toBeInstanceOf(ForbiddenException);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('reuses permissions resolved by the guard on a repeated check for the same request', async () => {
    const load = jest.fn(async () => ['product:read']);
    const { check } = makeGuard(['product:read'], { load });
    const req: Req = { user: { id: 'u1' } };
    await check(req);
    await check(req);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('does not reuse guard-resolved permissions after the verified user changes', async () => {
    const load = jest.fn(async (requestContext: RequestContext) => [`${requestContext.userId}:read`]);
    const context = new ContextService();
    const { check } = makeGuard(['u2:read'], { load }, context);
    const req: Req = { user: { id: 'u1' } };

    await context.run({}, async () => {
      await expect(check(req)).rejects.toBeInstanceOf(ForbiddenException);
      req.user = { id: 'u2' };
      await expect(check(req)).resolves.toBe(true);
    });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('uses verified-principal permissions without loading a second source', async () => {
    const load = jest.fn(async () => ['other']);
    const { check } = makeGuard(['product:read'], { load });
    const req: Req = { user: { sub: 'u1', permissions: ['product:read'] } };
    await expect(check(req)).resolves.toBe(true);
    expect(req.permissions).toEqual(['product:read']);
    expect(load).not.toHaveBeenCalled();
  });

  it('uses a configured principal resolver for consumer-specific claims', async () => {
    const context = new ContextService();
    const identity: ResolvedContextIdentityOptions = {
      principalResolver: (principal) => {
        const claims = principal as { uid: string; org: string };
        return { userId: claims.uid, tenant: claims.org, permissions: ['report:read'] };
      },
    };
    const { check } = makeGuard(['report:read'], { load: jest.fn() }, context, identity);

    await context.run({}, async () => {
      await expect(check({ user: { uid: 'custom-user', org: 'custom-tenant' } })).resolves.toBe(true);
      expect(context.store).toMatchObject({ userId: 'custom-user', tenant: 'custom-tenant' });
    });
  });

  it('fails safely when trusted gateway identity conflicts with the verified principal', async () => {
    const context = new ContextService();
    const { check } = makeGuard(undefined, { load: jest.fn() }, context);

    await context.run({ userId: 'gateway-user', tenant: 't1', identitySource: 'trusted-headers' }, async () => {
      await expect(check({ user: { sub: 'jwt-user', tenant: 't1' } })).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  it('fails safely when verified custom tenancy scope conflicts with trusted gateway scope', async () => {
    const context = new ContextService();
    const identity: ResolvedContextIdentityOptions = {
      principalResolver: (principal) => ({
        userId: (principal as { sub: string }).sub,
        custom: { department: { codes: ['D2'] } },
      }),
    };
    const { check } = makeGuard(undefined, { load: jest.fn() }, context, identity);

    await context.run({ custom: { department: { codes: ['D1'] } }, identitySource: 'trusted-headers' }, async () => {
      await expect(check({ user: { sub: 'jwt-user' } })).rejects.toMatchObject({
        response: { code: 'core.context.identity-conflict' },
      });
    });
  });

  it('accepts identical overlapping custom identity values', async () => {
    const context = new ContextService();
    const identity: ResolvedContextIdentityOptions = {
      principalResolver: (principal) => ({
        userId: (principal as { sub: string }).sub,
        custom: { department: { codes: ['D1'] } },
      }),
    };
    const { check } = makeGuard(undefined, { load: jest.fn() }, context, identity);

    await context.run({ custom: { department: { codes: ['D1'] } }, identitySource: 'trusted-headers' }, async () => {
      await expect(check({ user: { sub: 'jwt-user' } })).resolves.toBe(true);
    });
  });

  it('merges complementary trusted gateway values when verified values do not conflict', async () => {
    const context = new ContextService();
    const { check } = makeGuard(undefined, { load: jest.fn() }, context);

    await context.run({ tenant: 'gateway-tenant', identitySource: 'trusted-headers' }, async () => {
      const req = { user: { sub: 'jwt-user', roles: ['reader'] } };
      await expect(check(req)).resolves.toBe(true);
      await expect(check(req)).resolves.toBe(true);
      expect(context.store).toMatchObject({
        userId: 'jwt-user',
        tenant: 'gateway-tenant',
        roles: ['reader'],
        identitySource: 'verified-principal',
      });
    });
  });

  it.each([{}, { user: {} }, { user: { sub: '' } }, { user: { sub: 'u1', permissions: [42] } }])(
    'rejects a missing or invalid verified principal: %p',
    async (req) => {
      const { check } = makeGuard(undefined, { load: jest.fn() });
      await expect(check(req)).rejects.toBeInstanceOf(UnauthorizedException);
    },
  );

  it('honours a custom permission strategy check function', async () => {
    const wildcard = (codes: string[], required: string): boolean =>
      codes.some((code) => code === required || (code.endsWith(':*') && required.startsWith(code.slice(0, -1))));
    const { check } = makeGuard(['product:create'], { load: async () => ['product:*'], check: wildcard });
    await expect(check({ user: { id: 'u1' } })).resolves.toBe(true);
  });
});
