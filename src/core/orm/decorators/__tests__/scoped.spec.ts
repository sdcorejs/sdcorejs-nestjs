import 'reflect-metadata';
import { Scoped, getScopedColumns, SCOPED_METADATA } from '../scoped.decorator';

describe('@Scoped', () => {
  it('sets per-property metadata', () => {
    class Target {
      @Scoped() tenantCode!: string;
    }
    expect(Reflect.getMetadata(SCOPED_METADATA, Target.prototype, 'tenantCode')).toBe(true);
  });

  it('getScopedColumns lists all decorated columns', () => {
    class Multi {
      @Scoped() tenantCode!: string;
      @Scoped() departmentCode!: string;
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
      @Scoped() tenantCode!: string;
    }
    class Child extends Parent {
      @Scoped() projectCode!: string;
    }
    expect(getScopedColumns(Child).sort()).toEqual(['projectCode', 'tenantCode']);
  });

  it('does not duplicate when decorator applied twice on same property', () => {
    class Twice {
      @Scoped() @Scoped() tenantCode!: string;
    }
    expect(getScopedColumns(Twice)).toEqual(['tenantCode']);
  });
});
