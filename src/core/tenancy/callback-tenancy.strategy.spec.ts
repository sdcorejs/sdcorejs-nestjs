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
    expect(s.getBypassGrant(rc)).toBeUndefined();
  });
  it('delegates an explicit bypass grant', () => {
    const grant = {
      authorized: true as const,
      actorId: 'a1',
      reason: 'support',
      allowedTargets: ['product'],
      allowedOperations: ['read'] as const,
      audit: jest.fn(),
    };
    const s = new CallbackTenancyStrategy({ bypassGrant: () => grant });
    expect(s.getBypassGrant(rc)).toBe(grant);
  });
});
