import 'reflect-metadata';
import { Column, Entity, type DataSource } from 'typeorm';
import { createTestDataSource } from '../../fixtures/pg-mem-datasource';
import { BaseEntity } from '../../../src/orm/base-entity';
import { WithAudit } from '../../../src/orm/mixins';
import { TenantScoped } from '../../../src/orm/decorators/tenant-scoped.decorator';
import { BaseRepository } from '../../../src/orm/base-repository';
import { ContextService } from '../../../src/context/context.service';
import type { ITenancyStrategy } from '../../../src/tenancy/strategy.interface';
import {
  buildScopeFilters,
  applyScopeToEntity,
  getScopedColumns,
} from '../../../src/tenancy/tenancy.helpers';

@Entity('scoped_product')
class ScopedProduct extends WithAudit(BaseEntity) {
  @Column() name!: string;
  @Column() @TenantScoped() tenantCode!: string;
  @Column({ nullable: true }) @TenantScoped() departmentCode?: string;
}

@Entity('plain_product')
class PlainProduct extends BaseEntity {
  @Column() name!: string;
}

class ScopedRepo extends BaseRepository<ScopedProduct> {
  constructor(ds: DataSource, opts: ConstructorParameters<typeof BaseRepository>[2]) {
    super(ScopedProduct, ds, opts);
  }
}
class PlainRepo extends BaseRepository<PlainProduct> {
  constructor(ds: DataSource, opts: ConstructorParameters<typeof BaseRepository>[2]) {
    super(PlainProduct, ds, opts);
  }
}

const buildStrategy = (
  scope: Record<string, unknown>,
  bypass = false,
): ITenancyStrategy => ({
  getCurrentScope: () => scope,
  shouldBypass: () => bypass,
});

describe('Tenancy helpers (pure)', () => {
  it('buildScopeFilters emits EQUAL per scoped column with present value', () => {
    const filters = buildScopeFilters({ tenantCode: 'A', departmentCode: null }, ['tenantCode', 'departmentCode']);
    expect(filters).toHaveLength(1);
    expect(filters[0]).toEqual({ field: 'tenantCode', operator: 'EQUAL', data: 'A' });
  });

  it('applyScopeToEntity writes scope values into entity', () => {
    const e: Record<string, unknown> = { name: 'x' };
    applyScopeToEntity(e, { tenantCode: 'A', departmentCode: 'D' }, ['tenantCode', 'departmentCode']);
    expect(e.tenantCode).toBe('A');
    expect(e.departmentCode).toBe('D');
  });

  it('getScopedColumns on undecorated entity returns []', () => {
    expect(getScopedColumns(PlainProduct)).toEqual([]);
  });

  it('getScopedColumns on @TenantScoped entity returns column names', () => {
    expect(getScopedColumns(ScopedProduct).sort()).toEqual(['departmentCode', 'tenantCode']);
  });
});

describe('BaseRepository tenancy integration', () => {
  let ds: DataSource;
  let ctx: ContextService;

  beforeEach(async () => {
    ds = await createTestDataSource([ScopedProduct, PlainProduct]);
    ctx = new ContextService();
    await ds.getRepository(ScopedProduct).save([
      { name: 'A1', tenantCode: 'T1', departmentCode: 'D1' },
      { name: 'A2', tenantCode: 'T1', departmentCode: 'D2' },
      { name: 'B1', tenantCode: 'T2', departmentCode: 'D1' },
    ]);
    await ds.getRepository(PlainProduct).save([{ name: 'Plain' }]);
  });
  afterEach(async () => {
    await ds.destroy();
  });

  it('no strategy registered → repository ignores tenancy (zero overhead)', async () => {
    const repo = new ScopedRepo(ds, undefined);
    const r = await repo.paging({ pageNumber: 0, pageSize: 10 });
    expect(r.total).toBe(3);
  });

  it('strategy active + scope T1 → only T1 rows surface', async () => {
    const repo = new ScopedRepo(ds, {
      tenancyStrategy: buildStrategy({ tenantCode: 'T1' }),
      contextService: ctx,
    });
    const r = await repo.paging({ pageNumber: 0, pageSize: 10 });
    expect(r.total).toBe(2);
  });

  it('strategy active + multi-column scope filters BOTH columns', async () => {
    const repo = new ScopedRepo(ds, {
      tenancyStrategy: buildStrategy({ tenantCode: 'T1', departmentCode: 'D2' }),
      contextService: ctx,
    });
    const r = await repo.paging({ pageNumber: 0, pageSize: 10 });
    expect(r.total).toBe(1);
    expect(r.items[0].name).toBe('A2');
  });

  it('shouldBypass=true skips filter injection', async () => {
    const repo = new ScopedRepo(ds, {
      tenancyStrategy: buildStrategy({ tenantCode: 'T1' }, true),
      contextService: ctx,
    });
    const r = await repo.paging({ pageNumber: 0, pageSize: 10 });
    expect(r.total).toBe(3);
  });

  it('entity without @TenantScoped is not scoped even with strategy', async () => {
    const repo = new PlainRepo(ds, {
      tenancyStrategy: buildStrategy({ tenantCode: 'T1' }),
      contextService: ctx,
    });
    const r = await repo.paging({ pageNumber: 0, pageSize: 10 });
    expect(r.total).toBe(1);
  });

  it('create auto-fills scoped columns from scope', async () => {
    const repo = new ScopedRepo(ds, {
      tenancyStrategy: buildStrategy({ tenantCode: 'T3', departmentCode: 'D9' }),
      contextService: ctx,
    });
    const saved = await repo.create({ name: 'C' });
    expect(saved.tenantCode).toBe('T3');
    expect(saved.departmentCode).toBe('D9');
  });

  it('shouldBypass=true skips auto-fill on create', async () => {
    const repo = new ScopedRepo(ds, {
      tenancyStrategy: buildStrategy({ tenantCode: 'T3' }, true),
      contextService: ctx,
    });
    const saved = await repo.create({ name: 'C', tenantCode: 'T_custom' });
    expect(saved.tenantCode).toBe('T_custom');
  });
});
