import { Test } from '@nestjs/testing';
import {
  ContextModule,
  ContextService,
  ContextMiddleware,
  DEFAULT_HEADERS_CONFIG,
  CONTEXT_HEADERS_CONFIG,
  type HeadersConfig,
} from '../../../src/context';

describe('ContextService — AsyncLocalStorage preservation', () => {
  let service: ContextService;

  beforeEach(async () => {
    const mod = await Test.createTestingModule({ imports: [ContextModule.forRoot()] }).compile();
    service = mod.get(ContextService);
  });

  it('returns undefined when no store active', () => {
    expect(service.userId).toBeUndefined();
    expect(service.get('tenantCode')).toBeUndefined();
    expect(service.store).toBeUndefined();
  });

  it('preserves store across nested await', async () => {
    await service.run({ userId: 'u1', tenantCode: 'T1' }, async () => {
      expect(service.userId).toBe('u1');
      await Promise.resolve();
      expect(service.tenantCode).toBe('T1');
      const inner = async () => {
        await Promise.resolve();
        return service.userId;
      };
      expect(await inner()).toBe('u1');
    });
  });

  it('preserves store across Promise.all', async () => {
    await service.run({ userId: 'u2' }, async () => {
      const results = await Promise.all([
        (async () => { await Promise.resolve(); return service.userId; })(),
        (async () => { await Promise.resolve(); return service.userId; })(),
      ]);
      expect(results).toEqual(['u2', 'u2']);
    });
  });

  it('preserves store across setImmediate', (done) => {
    service.run({ userId: 'u3' }, () => {
      setImmediate(() => {
        expect(service.userId).toBe('u3');
        done();
      });
    });
  });

  it('preserves store across setTimeout', (done) => {
    service.run({ userId: 'u4' }, () => {
      setTimeout(() => {
        expect(service.userId).toBe('u4');
        done();
      }, 10);
    });
  });

  it('isolates stores between separate run() invocations', () => {
    const r1 = service.run({ userId: 'a' }, () => service.userId);
    const r2 = service.run({ userId: 'b' }, () => service.userId);
    expect(r1).toBe('a');
    expect(r2).toBe('b');
    expect(service.userId).toBeUndefined();
  });

  it('lang defaults to vi when not set', () => {
    expect(service.lang).toBe('vi');
  });

  it('lang reflects store value', () => {
    service.run({ lang: 'en' }, () => {
      expect(service.lang).toBe('en');
    });
  });

  it('hasPermission checks permissions array', () => {
    service.run({ permissions: ['product:create', 'product:update'] }, () => {
      expect(service.hasPermission('product:create')).toBe(true);
      expect(service.hasPermission('product:delete')).toBe(false);
    });
  });

  it('set() mutates active store; no-op outside store', () => {
    service.set('userId', 'orphan');
    expect(service.userId).toBeUndefined();
    service.run({}, () => {
      service.set('userId', 'set-in-run');
      expect(service.userId).toBe('set-in-run');
    });
  });

  it('custom bag reads via getCustom', () => {
    service.run({ custom: { departmentCode: 'D1', isAdmin: true } }, () => {
      expect(service.getCustom('departmentCode')).toBe('D1');
      expect(service.getCustom<boolean>('isAdmin')).toBe(true);
    });
  });

  it('getCustom returns undefined when no store / no custom key', () => {
    expect(service.getCustom('any')).toBeUndefined();
    service.run({}, () => {
      expect(service.getCustom('any')).toBeUndefined();
    });
  });
});

describe('ContextModule.forRoot — headers config', () => {
  it('registers default headers config when no overrides passed', async () => {
    const mod = await Test.createTestingModule({ imports: [ContextModule.forRoot()] }).compile();
    const cfg = mod.get<HeadersConfig>(CONTEXT_HEADERS_CONFIG);
    expect(cfg.tenantCode).toBe('x-tenant-code');
    expect(cfg.userId).toBe('x-user-id');
    expect(cfg.lang).toEqual(['accept-language', 'x-language']);
  });

  it('merges overrides with defaults', async () => {
    const mod = await Test.createTestingModule({
      imports: [ContextModule.forRoot({ headers: { tenantCode: 'X-Org-Id' } })],
    }).compile();
    const cfg = mod.get<HeadersConfig>(CONTEXT_HEADERS_CONFIG);
    expect(cfg.tenantCode).toBe('X-Org-Id');
    expect(cfg.userId).toBe('x-user-id');
  });
});

describe('ContextMiddleware — header reading', () => {
  const buildMw = () => {
    const ctx = new ContextService();
    const mw = new ContextMiddleware(ctx, DEFAULT_HEADERS_CONFIG);
    return { ctx, mw };
  };

  it('populates store from canonical headers', async () => {
    const { ctx, mw } = buildMw();
    const req = {
      headers: {
        'x-tenant-code': 'T-ABC',
        'x-user-id': 'u-42',
        'accept-language': 'en-US,vi;q=0.9',
        'authorization': 'Bearer xyz',
      },
    };
    await new Promise<void>((resolve) => {
      mw.use(req as never, {} as never, () => {
        expect(ctx.tenantCode).toBe('T-ABC');
        expect(ctx.userId).toBe('u-42');
        expect(ctx.lang).toBe('en');
        expect(ctx.token).toBe('Bearer xyz');
        resolve();
      });
    });
  });

  it('customHeaders pushes values into ctx.custom', async () => {
    const ctx = new ContextService();
    const mw = new ContextMiddleware(ctx, {
      ...DEFAULT_HEADERS_CONFIG,
      customHeaders: { departmentCode: 'x-department-code', project: 'x-project' },
    });
    const req = {
      headers: { 'x-department-code': 'D-1', 'x-project': 'PRJ' },
    };
    await new Promise<void>((resolve) => {
      mw.use(req as never, {} as never, () => {
        expect(ctx.getCustom('departmentCode')).toBe('D-1');
        expect(ctx.getCustom('project')).toBe('PRJ');
        resolve();
      });
    });
  });

  it('lang defaults to vi when no language header present', async () => {
    const { ctx, mw } = buildMw();
    await new Promise<void>((resolve) => {
      mw.use({ headers: {} } as never, {} as never, () => {
        expect(ctx.lang).toBe('vi');
        resolve();
      });
    });
  });

  it('x-language header used when accept-language absent', async () => {
    const { ctx, mw } = buildMw();
    await new Promise<void>((resolve) => {
      mw.use(
        { headers: { 'x-language': 'EN' } } as never,
        {} as never,
        () => {
          expect(ctx.lang).toBe('en');
          resolve();
        },
      );
    });
  });

  it('handles array-valued headers (multi-value HTTP) by taking first', async () => {
    const { ctx, mw } = buildMw();
    await new Promise<void>((resolve) => {
      mw.use(
        { headers: { 'x-tenant-code': ['T-FIRST', 'T-SECOND'] } } as never,
        {} as never,
        () => {
          expect(ctx.tenantCode).toBe('T-FIRST');
          resolve();
        },
      );
    });
  });

  it('NO cls-hooked dependency anywhere in source', () => {
    expect(() => require.resolve('cls-hooked')).toThrow();
  });
});
