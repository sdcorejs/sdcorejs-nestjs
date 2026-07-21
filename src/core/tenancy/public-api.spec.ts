import * as tenancy from './index';
import * as orm from '../orm';

describe('tenancy public API', () => {
  it('does NOT re-export ORM decorators (canonical path is @sdcorejs/nestjs/core)', () => {
    expect((tenancy as Record<string, unknown>).TenantScoped).toBeUndefined();
    expect((tenancy as Record<string, unknown>).Scoped).toBeUndefined();
    expect((tenancy as Record<string, unknown>).getScopedColumns).toBeUndefined();
  });

  it('orm exports @Scoped + its metadata helpers (the removed TenantScoped alias is gone)', () => {
    expect((orm as Record<string, unknown>).TenantScoped).toBeUndefined();
    expect(typeof (orm as Record<string, unknown>).Scoped).toBe('function');
    expect(typeof (orm as Record<string, unknown>).getScopedColumns).toBe('function');
    expect(typeof (orm as Record<string, unknown>).getScopedColumnMetadata).toBe('function');
  });
});
