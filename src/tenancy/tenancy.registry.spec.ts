import 'reflect-metadata';
import { Scoped } from '../orm/decorators/tenant-scoped.decorator';
import { BaseRepository } from '../orm/base-repository';
import { registerTenancy, getTenancy } from './tenancy.registry';
import type { ITenancyStrategy } from './strategy.interface';

class Foo {
  @Scoped() tenantCode!: string;
  @Scoped() departmentCode!: string;
}

class FooRepo extends BaseRepository<Foo> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor() {
    super(Foo, {} as any);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addon(f?: any[]) {
    return this.addonFilter(f as any);
  }
  where() {
    return this.scopeWhere();
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fill(e: any) {
    this.fillTenancy(e);
    return e;
  }
}

const strategy = (scope: Record<string, unknown>, bypass = false): ITenancyStrategy => ({
  getCurrentScope: () => scope,
  shouldBypass: () => bypass,
});
const withCtx = (store: Record<string, unknown>, s: ITenancyStrategy) =>
  ({ strategy: s, contextService: { store } }) as unknown as Parameters<typeof registerTenancy>[0];

describe('tenancy registry', () => {
  afterEach(() => registerTenancy(undefined as never));

  it('register/get round-trips', () => {
    const t = { strategy: strategy({}) };
    registerTenancy(t);
    expect(getTenancy()).toBe(t);
  });

  it('BaseRepository auto-injects scope filters from the global registry', () => {
    registerTenancy(withCtx({}, strategy({ tenantCode: 't1', departmentCode: 'd1' })));
    const repo = new FooRepo();
    expect(repo.addon([])).toEqual([
      { field: 'tenantCode', operator: 'EQUAL', data: 't1' },
      { field: 'departmentCode', operator: 'EQUAL', data: 'd1' },
    ]);
    expect(repo.where()).toEqual({ tenantCode: 't1', departmentCode: 'd1' });
    expect(repo.fill({})).toEqual({ tenantCode: 't1', departmentCode: 'd1' });
  });

  it('bypass → no filters, no fill', () => {
    registerTenancy(withCtx({}, strategy({ tenantCode: 't1' }, true)));
    const repo = new FooRepo();
    expect(repo.addon([])).toEqual([]);
    expect(repo.fill({})).toEqual({});
  });

  it('no registry → no-op', () => {
    const repo = new FooRepo();
    expect(repo.addon([])).toEqual([]);
    expect(repo.where()).toEqual({});
  });

  it('per-repo tenancyStrategy option overrides the global registry', () => {
    registerTenancy(withCtx({}, strategy({ tenantCode: 'GLOBAL' })));
    class OverrideRepo extends BaseRepository<Foo> {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      constructor() {
        super(Foo, {} as any, {
          tenancyStrategy: strategy({ tenantCode: 'OVERRIDE' }),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          contextService: { store: {} } as any,
        });
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      addon(f?: any[]) {
        return this.addonFilter(f as any);
      }
    }
    expect(new OverrideRepo().addon([])).toEqual([{ field: 'tenantCode', operator: 'EQUAL', data: 'OVERRIDE' }]);
  });
});
