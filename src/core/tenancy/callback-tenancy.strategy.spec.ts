import { CallbackTenancyStrategy } from './callback-tenancy.strategy';
import type { RequestContext } from '../context/types';

const rc = { tenant: 't1', custom: { departmentCode: 'd1', isMaster: false } } as unknown as RequestContext;

describe('CallbackTenancyStrategy', () => {
  it('delegates resolve + bypass', () => {
    const s = new CallbackTenancyStrategy({
      resolve: (c) => ({ tenantCode: c.tenant, departmentCode: (c.custom as any)?.departmentCode }),
      bypass: (c) => (c.custom as any)?.isMaster === true,
    });
    expect(s.getCurrentScope(rc)).toEqual({ tenantCode: 't1', departmentCode: 'd1' });
    expect(s.shouldBypass(rc)).toBe(false);
  });
  it('defaults: empty scope, no bypass', () => {
    const s = new CallbackTenancyStrategy({});
    expect(s.getCurrentScope(rc)).toEqual({});
    expect(s.shouldBypass(rc)).toBe(false);
  });
});
