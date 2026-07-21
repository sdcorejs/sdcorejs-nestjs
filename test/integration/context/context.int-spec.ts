import { UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  ContextModule,
  ContextService,
  ContextMiddleware,
  CONTEXT_HEADERS_CONFIG,
  CONTEXT_IDENTITY_CONFIG,
  defaultVerifiedPrincipalResolver,
  type HeadersConfig,
  type RequestContext,
  type ResolvedContextIdentityOptions,
} from '../../../src/core/context';
import { DEFAULT_HEADERS_CONFIG } from '../../../src/core/context/types';

describe('ContextService - AsyncLocalStorage preservation', () => {
  let service: ContextService;

  beforeEach(async () => {
    const mod = await Test.createTestingModule({ imports: [ContextModule.forRoot()] }).compile();
    service = mod.get(ContextService);
  });

  it('returns undefined when no store is active', () => {
    expect(service.userId).toBeUndefined();
    expect(service.get('tenant')).toBeUndefined();
    expect(service.store).toBeUndefined();
  });

  it('preserves and isolates stores across async work', async () => {
    await service.run({ userId: 'u1', tenant: 'T1' }, async () => {
      await Promise.resolve();
      expect(await Promise.all([Promise.resolve(service.userId), Promise.resolve(service.tenant)])).toEqual(['u1', 'T1']);
    });
    expect(service.store).toBeUndefined();
    expect(service.run({ userId: 'u2' }, () => service.userId)).toBe('u2');
  });

  it('preserves a store across timers', (done) => {
    service.run({ userId: 'u3' }, () => {
      setImmediate(() => {
        expect(service.userId).toBe('u3');
        done();
      });
    });
  });

  it('supports generic fields, custom values, and permission checks', () => {
    service.run({ lang: 'en', custom: { departmentCode: 'D1' }, permissions: ['product:read'] }, () => {
      expect(service.lang).toBe('en');
      expect(service.getCustom('departmentCode')).toBe('D1');
      expect(service.hasPermission('product:read')).toBe(true);
      expect(service.hasPermission('product:write')).toBe(false);
    });
  });

  it('setIdentity clears stale security fields and records the verified source', () => {
    const user = { sub: 'u2' };
    service.run(
      {
        userId: 'forged',
        tenant: 'old',
        roles: ['old'],
        permissions: ['admin'],
        permissionVersion: 'old',
        identitySource: 'trusted-headers',
      },
      () => {
        service.setIdentity(
          { userId: 'u2', tenant: 'T2', roles: ['reader'], permissions: ['read'], permissionVersion: 'v2' },
          'verified-principal',
          user,
        );
        expect(service.store).toMatchObject({
          userId: 'u2',
          tenant: 'T2',
          roles: ['reader'],
          permissions: ['read'],
          permissionVersion: 'v2',
          identitySource: 'verified-principal',
          user,
        });
      },
    );
  });

  it('set() is a no-op outside a store', () => {
    service.set('userId', 'orphan');
    expect(service.userId).toBeUndefined();
  });
});

describe('ContextModule.forRoot - identity and headers config', () => {
  it('registers defaults and keeps trusted-header mode disabled', async () => {
    const mod = await Test.createTestingModule({ imports: [ContextModule.forRoot()] }).compile();
    const headers = mod.get<HeadersConfig>(CONTEXT_HEADERS_CONFIG);
    const identity = mod.get<ResolvedContextIdentityOptions>(CONTEXT_IDENTITY_CONFIG);
    expect(headers).toMatchObject({ tenant: 'x-tenant', userId: 'x-user-id' });
    expect(headers.lang).toEqual(['accept-language', 'x-language']);
    expect(identity.principalResolver).toBe(defaultVerifiedPrincipalResolver);
    expect(identity.trustedHeaders).toBeUndefined();
  });

  it('merges header overrides and registers a custom principal resolver', async () => {
    const resolver = jest.fn(() => ({ userId: 'resolved' }));
    const mod = await Test.createTestingModule({
      imports: [ContextModule.forRoot({ headers: { tenant: 'X-Org-Id' }, identity: { principalResolver: resolver } })],
    }).compile();
    expect(mod.get<HeadersConfig>(CONTEXT_HEADERS_CONFIG).tenant).toBe('X-Org-Id');
    expect(mod.get<ResolvedContextIdentityOptions>(CONTEXT_IDENTITY_CONFIG).principalResolver).toBe(resolver);
  });

  it('rejects trusted-header mode without a trust verifier at startup', () => {
    expect(() =>
      ContextModule.forRoot({
        identity: { trustedHeaders: {} as never },
      }),
    ).toThrow('context.identity.trustedHeaders.isTrustedRequest');
  });
});

describe('ContextMiddleware - identity trust boundary', () => {
  const defaultIdentity: ResolvedContextIdentityOptions = { principalResolver: defaultVerifiedPrincipalResolver };
  const build = (identity: ResolvedContextIdentityOptions = defaultIdentity, headers: HeadersConfig = DEFAULT_HEADERS_CONFIG) => {
    const ctx = new ContextService();
    return { ctx, middleware: new ContextMiddleware(ctx, headers, identity) };
  };
  const capture = async (middleware: ContextMiddleware, ctx: ContextService, headers: Record<string, unknown>) =>
    new Promise<RequestContext>((resolve) => {
      middleware.use({ headers } as never, {} as never, () => resolve({ ...ctx.store, request: undefined, response: undefined }));
    });

  it('ignores tenant, user, and custom identity headers by default', async () => {
    const headers = {
      ...DEFAULT_HEADERS_CONFIG,
      customHeaders: { departmentCode: 'x-department-code' },
    };
    const { ctx, middleware } = build(defaultIdentity, headers);
    const store = await capture(middleware, ctx, {
      'x-tenant': 'forged-tenant',
      'x-user-id': 'forged-user',
      'x-department-code': 'forged-department',
      'accept-language': 'en-US,vi;q=0.9',
      authorization: 'Bearer xyz',
    });

    expect(store).toMatchObject({ lang: 'en-US,vi;q=0.9', token: 'Bearer xyz' });
    expect(store.tenant).toBeUndefined();
    expect(store.userId).toBeUndefined();
    expect(store.custom).toBeUndefined();
    expect(store.identitySource).toBeUndefined();
  });

  it('accepts configured identity headers only after request trust verification', async () => {
    const headers = {
      ...DEFAULT_HEADERS_CONFIG,
      customHeaders: { departmentCode: 'x-department-code' },
    };
    const verify = jest.fn(() => true);
    const { ctx, middleware } = build(
      { principalResolver: defaultVerifiedPrincipalResolver, trustedHeaders: { isTrustedRequest: verify } },
      headers,
    );
    const store = await capture(middleware, ctx, {
      'x-tenant': ['T-FIRST', 'T-SECOND'],
      'x-user-id': 'u-42',
      'x-department-code': 'D-1',
    });

    expect(verify).toHaveBeenCalledTimes(1);
    expect(store).toMatchObject({
      tenant: 'T-FIRST',
      userId: 'u-42',
      custom: { departmentCode: 'D-1' },
      identitySource: 'trusted-headers',
    });
  });

  it('rejects identity headers when explicit trusted mode cannot verify the request', () => {
    const { middleware } = build({
      principalResolver: defaultVerifiedPrincipalResolver,
      trustedHeaders: { isTrustedRequest: () => false },
    });

    expect(() => middleware.use({ headers: { 'x-user-id': 'forged' } } as never, {} as never, jest.fn())).toThrow(UnauthorizedException);
  });

  it('normalizes a custom trusted-header resolver result', async () => {
    const { ctx, middleware } = build({
      principalResolver: defaultVerifiedPrincipalResolver,
      trustedHeaders: {
        isTrustedRequest: () => true,
        resolve: () => ({ userId: 'gateway-user', tenant: 'gateway-tenant', permissions: ['read'] }),
      },
    });
    const store = await capture(middleware, ctx, { 'x-user-id': 'trigger' });
    expect(store).toMatchObject({
      userId: 'gateway-user',
      tenant: 'gateway-tenant',
      permissions: ['read'],
      identitySource: 'trusted-headers',
    });
  });

  it('still resolves language independently of identity mode', async () => {
    const { ctx, middleware } = build();
    expect((await capture(middleware, ctx, { 'x-language': 'vi' })).lang).toBe('vi');
    expect((await capture(middleware, ctx, {})).lang).toBeUndefined();
  });

  it('has no cls-hooked dependency', () => {
    expect(() => require.resolve('cls-hooked')).toThrow();
  });
});
