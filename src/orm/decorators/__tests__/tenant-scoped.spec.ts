import 'reflect-metadata';
import { TenantScoped, getScopedColumns, TENANT_SCOPED_METADATA } from '../tenant-scoped.decorator';

describe('@TenantScoped', () => {
  it('sets per-property metadata', () => {
    class Scoped {
      @TenantScoped() tenantCode!: string;
    }
    expect(Reflect.getMetadata(TENANT_SCOPED_METADATA, Scoped.prototype, 'tenantCode')).toBe(true);
  });

  it('getScopedColumns lists all decorated columns', () => {
    class Multi {
      @TenantScoped() tenantCode!: string;
      @TenantScoped() departmentCode!: string;
      otherField!: string;
    }
    expect(getScopedColumns(Multi).sort()).toEqual(['departmentCode', 'tenantCode']);
  });

  it('getScopedColumns returns [] when no decorator applied', () => {
    class NoScope {
      foo!: string;
    }
    expect(getScopedColumns(NoScope)).toEqual([]);
  });

  it('inherits scoped columns through prototype chain', () => {
    class Parent {
      @TenantScoped() tenantCode!: string;
    }
    class Child extends Parent {
      @TenantScoped() projectCode!: string;
    }
    expect(getScopedColumns(Child).sort()).toEqual(['projectCode', 'tenantCode']);
  });

  it('does not duplicate when decorator applied twice on same property', () => {
    class Twice {
      @TenantScoped() @TenantScoped() tenantCode!: string;
    }
    expect(getScopedColumns(Twice)).toEqual(['tenantCode']);
  });
});
