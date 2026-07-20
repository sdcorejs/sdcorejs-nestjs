import 'reflect-metadata';
import { Column, Entity, type DataSource } from 'typeorm';
import { createTestDataSource } from '../../fixtures/pg-mem-datasource';
import { BaseEntity } from '../../../src/core/orm/base-entity';
import { WithAudit } from '../../../src/core/orm/mixins';
import { Scoped } from '../../../src/core/orm/decorators/scoped.decorator';
import { BaseRepository } from '../../../src/core/orm/base-repository';
import { ContextService } from '../../../src/core/context/context.service';
import { TENANCY_OPERATIONS, type ITenancyStrategy, type TenancyBypassGrant } from '../../../src/core/tenancy/strategy.interface';
import { buildScopeFilters, applyScopeToEntity, getScopedColumns } from '../../../src/core/tenancy/tenancy.helpers';
import { InvalidTenancyScopeError, MissingTenancyContextError, UnauthorizedTenancyBypassError } from '../../../src/core/tenancy/errors';

@Entity('scoped_product')
class ScopedProduct extends WithAudit(BaseEntity) {
  @Column() name!: string;
  @Column() @Scoped() tenantCode!: string;
  @Column({ nullable: true }) @Scoped({ required: false }) departmentCode?: string;
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

const buildStrategy = (scope: Record<string, unknown>, bypass = false, grant?: TenancyBypassGrant): ITenancyStrategy => ({
  getCurrentScope: () => scope,
  shouldBypass: () => bypass,
  getBypassGrant: () => grant,
});

const bypassGrant = (audit = jest.fn()): TenancyBypassGrant => ({
  authorized: true,
  actorId: 'admin-1',
  reason: 'test-support',
  allowedTargets: ['scoped_product'],
  allowedOperations: TENANCY_OPERATIONS,
  audit,
});

describe('Tenancy helpers (pure)', () => {
  it('buildScopeFilters emits EQUAL per scoped column with present value', () => {
    const filters = buildScopeFilters({ tenantCode: 'A', departmentCode: null }, [
      { propertyName: 'tenantCode', required: true },
      { propertyName: 'departmentCode', required: false },
    ]);
    expect(filters).toHaveLength(1);
    expect(filters[0]).toEqual({ field: 'tenantCode', operator: 'EQUAL', data: 'A' });
  });

  it('buildScopeFilters emits IN for array scope value', () => {
    const filters = buildScopeFilters({ departmentCode: ['D1', 'D2'] }, ['departmentCode']);
    expect(filters).toEqual([{ field: 'departmentCode', operator: 'IN', data: ['D1', 'D2'] }]);
  });

  it('buildScopeFilters preserves empty array as a deny-all scope value', () => {
    const filters = buildScopeFilters({ departmentCode: [] }, ['departmentCode']);
    expect(filters).toEqual([{ field: 'departmentCode', operator: 'IN', data: [] }]);
  });

  it.each(['', '   '])('rejects a blank required scope value %p', (tenantCode) => {
    expect(() => buildScopeFilters({ tenantCode }, ['tenantCode'])).toThrow(InvalidTenancyScopeError);
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

  it('getScopedColumns on @Scoped entity returns column names', () => {
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

  it('no strategy registered → scoped repository fails closed', async () => {
    const repo = new ScopedRepo(ds, undefined);
    await expect(repo.paging({ pageNumber: 0, pageSize: 10 })).rejects.toBeInstanceOf(MissingTenancyContextError);
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

  it('array scope value filters via IN (multi-department user)', async () => {
    const repo = new ScopedRepo(ds, {
      tenancyStrategy: buildStrategy({ tenantCode: 'T1', departmentCode: ['D1', 'D2'] }),
      contextService: ctx,
    });
    const r = await repo.paging({ pageNumber: 0, pageSize: 10 });
    expect(r.total).toBe(2);
  });

  it('legacy shouldBypass=true is rejected', async () => {
    const repo = new ScopedRepo(ds, {
      tenancyStrategy: buildStrategy({ tenantCode: 'T1' }, true),
      contextService: ctx,
    });
    await expect(repo.paging({ pageNumber: 0, pageSize: 10 })).rejects.toBeInstanceOf(UnauthorizedTenancyBypassError);
  });

  it('authorized bypass grant skips filtering and is audited', async () => {
    const audit = jest.fn();
    const repo = new ScopedRepo(ds, {
      tenancyStrategy: buildStrategy({ tenantCode: 'T1' }, false, bypassGrant(audit)),
      contextService: ctx,
    });
    const r = await repo.paging({ pageNumber: 0, pageSize: 10 });
    expect(r.total).toBe(3);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ operation: 'read', target: 'scoped_product' }));
  });

  it('entity without @Scoped is not scoped even with strategy', async () => {
    const repo = new PlainRepo(ds, {
      tenancyStrategy: buildStrategy({ tenantCode: 'T1' }),
      contextService: ctx,
    });
    const r = await repo.paging({ pageNumber: 0, pageSize: 10 });
    expect(r.total).toBe(1);
  });

  it('detail returns an in-scope row', async () => {
    const row = await ds.getRepository(ScopedProduct).findOneBy({ name: 'A1' });
    const repo = new ScopedRepo(ds, {
      tenancyStrategy: buildStrategy({ tenantCode: 'T1' }),
      contextService: ctx,
    });
    const found = await repo.detail(row!.id);
    expect(found?.name).toBe('A1');
  });

  it('detail excludes soft-deleted rows by default and includes them only when explicitly requested', async () => {
    const row = await ds.getRepository(ScopedProduct).findOneByOrFail({ name: 'A1' });
    await ds.getRepository(ScopedProduct).softDelete(row.id);
    const repo = new ScopedRepo(ds, {
      tenancyStrategy: buildStrategy({ tenantCode: 'T1' }),
      contextService: ctx,
    });

    await expect(repo.detail(row.id)).resolves.toBeNull();
    await expect(repo.detail(row.id, { withDeleted: true })).resolves.toMatchObject({ id: row.id, name: 'A1' });
  });

  it('detail returns null for an out-of-scope row (no cross-tenant id leak)', async () => {
    const row = await ds.getRepository(ScopedProduct).findOneBy({ name: 'B1' }); // tenant T2
    const repo = new ScopedRepo(ds, {
      tenancyStrategy: buildStrategy({ tenantCode: 'T1' }),
      contextService: ctx,
    });
    const found = await repo.detail(row!.id);
    expect(found).toBeNull();
  });

  it('detail with array scope honours IN', async () => {
    const row = await ds.getRepository(ScopedProduct).findOneBy({ name: 'A2' }); // T1/D2
    const repo = new ScopedRepo(ds, {
      tenancyStrategy: buildStrategy({ tenantCode: 'T1', departmentCode: ['D1', 'D2'] }),
      contextService: ctx,
    });
    const found = await repo.detail(row!.id);
    expect(found?.name).toBe('A2');
  });

  it('detail with authorized bypass ignores scope', async () => {
    const row = await ds.getRepository(ScopedProduct).findOneBy({ name: 'B1' }); // tenant T2
    const repo = new ScopedRepo(ds, {
      tenancyStrategy: buildStrategy({ tenantCode: 'T1' }, false, bypassGrant()),
      contextService: ctx,
    });
    const found = await repo.detail(row!.id);
    expect(found?.name).toBe('B1');
  });

  it('search by UUID is tenancy-scoped (no cross-tenant id leak)', async () => {
    const b1 = await ds.getRepository(ScopedProduct).findOneBy({ name: 'B1' }); // tenant T2
    const repo = new ScopedRepo(ds, { tenancyStrategy: buildStrategy({ tenantCode: 'T1' }), contextService: ctx });
    const found = await repo.search(b1!.id);
    expect(found).toEqual([]); // B1 belongs to T2 → filtered out under scope T1
  });

  it('search by UUID returns an in-scope row', async () => {
    const a1 = await ds.getRepository(ScopedProduct).findOneBy({ name: 'A1' }); // tenant T1
    const repo = new ScopedRepo(ds, { tenancyStrategy: buildStrategy({ tenantCode: 'T1' }), contextService: ctx });
    const found = await repo.search(a1!.id);
    expect(found).toHaveLength(1);
    expect(found[0].name).toBe('A1');
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

  it('authorized bypass skips auto-fill on create', async () => {
    const repo = new ScopedRepo(ds, {
      tenancyStrategy: buildStrategy({ tenantCode: 'T3' }, false, bypassGrant()),
      contextService: ctx,
    });
    const saved = await repo.create({ name: 'C', tenantCode: 'T_custom' });
    expect(saved.tenantCode).toBe('T_custom');
  });
});
