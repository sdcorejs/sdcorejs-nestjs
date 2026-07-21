import 'reflect-metadata';
import { NotFoundException } from '@nestjs/common';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { Column, DataSource, DeleteDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, type ObjectLiteral } from 'typeorm';
import { BaseRepository, InactiveMutationTransactionError, type BaseRepositoryOptions } from '../../../src/core/orm/base-repository';
import { Scoped } from '../../../src/core/orm/decorators/scoped.decorator';
import {
  InvalidTenancyScopeError,
  MissingTenancyContextError,
  MissingTenancyScopeError,
  UnauthorizedTenancyBypassError,
} from '../../../src/core/tenancy/errors';
import type { ITenancyStrategy, TenancyBypassGrant } from '../../../src/core/tenancy/strategy.interface';

@Entity('secure_scoped_product')
class SecureScopedProduct {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'varchar' }) name!: string;
  @Column({ type: 'varchar', name: 'tenant_code' }) @Scoped() tenantCode!: string;
  @Column({ type: 'varchar', name: 'department_code', nullable: true })
  @Scoped({ required: false })
  departmentCode?: string;
  @DeleteDateColumn({ type: 'timestamptz', nullable: true }) deletedAt?: Date;
}

@Entity('secure_scoped_child')
class SecureScopedChild {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'varchar' }) name!: string;
  @Column({ type: 'varchar', name: 'tenant_code' }) @Scoped() tenantCode!: string;
}

@Entity('secure_scoped_parent')
class SecureScopedParent {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'varchar' }) name!: string;
  @Column({ type: 'varchar', name: 'tenant_code' }) @Scoped() tenantCode!: string;
  @ManyToOne(() => SecureScopedChild, { nullable: false })
  @JoinColumn({ name: 'child_id' })
  child!: SecureScopedChild;
}

class SecureProductRepository extends BaseRepository<SecureScopedProduct> {
  constructor(ds: DataSource, options?: BaseRepositoryOptions) {
    super(SecureScopedProduct, ds, options);
  }
}

class SecureParentRepository extends BaseRepository<SecureScopedParent> {
  constructor(ds: DataSource, options?: BaseRepositoryOptions) {
    super(SecureScopedParent, ds, options);
  }
}

function strategy(scope: Record<string, unknown>, overrides: Partial<ITenancyStrategy> = {}): ITenancyStrategy {
  return {
    getCurrentScope: () => scope,
    shouldBypass: () => false,
    ...overrides,
  };
}

async function createDataSource(entities: Array<new () => ObjectLiteral>): Promise<{ ds: DataSource; db: IMemoryDb; queries: string[] }> {
  const db = newDb({ autoCreateForeignKeyIndices: true });
  db.public.registerFunction({ name: 'version', args: [], returns: DataType.text, implementation: () => 'PostgreSQL 14.0 (pg-mem)' });
  db.public.registerFunction({ name: 'current_database', args: [], returns: DataType.text, implementation: () => 'pg-mem' });
  db.public.registerFunction({
    name: 'uuid_generate_v4',
    returns: DataType.uuid,
    implementation: () => globalThis.crypto.randomUUID(),
    impure: true,
  });
  const queries: string[] = [];
  db.on('query', (query) => queries.push(query));
  const ds = db.adapters.createTypeormDataSource({ type: 'postgres', entities, synchronize: true }) as DataSource;
  await ds.initialize();
  return { ds, db, queries };
}

describe('BaseRepository scoped mutations', () => {
  let ds: DataSource;
  let queries: string[];
  let tenantA: SecureProductRepository;
  let a: SecureScopedProduct;
  let b: SecureScopedProduct;

  beforeEach(async () => {
    ({ ds, queries } = await createDataSource([SecureScopedProduct]));
    const raw = ds.getRepository(SecureScopedProduct);
    [a, b] = await raw.save([
      raw.create({ name: 'A', tenantCode: 'A', departmentCode: 'D1' }),
      raw.create({ name: 'B', tenantCode: 'B', departmentCode: 'D1' }),
    ]);
    tenantA = new SecureProductRepository(ds, { tenancyStrategy: strategy({ tenantCode: 'A' }) });
    queries.length = 0;
  });

  afterEach(async () => ds.destroy());

  it('rejects cross-tenant update and keeps the mutation predicate in the SQL statement', async () => {
    await expect(tenantA.update({ id: b.id, name: 'forged' })).rejects.toBeInstanceOf(NotFoundException);
    expect((await ds.getRepository(SecureScopedProduct).findOneByOrFail({ id: b.id })).name).toBe('B');
    const sql = queries.find((query) => /^UPDATE /i.test(query.trim()));
    expect(sql).toContain('"tenant_code"');
    expect(sql).toContain('"id"');
  });

  it.each([
    ['delete', (repo: SecureProductRepository, id: string) => repo.delete(id)],
    ['softDelete', (repo: SecureProductRepository, id: string) => repo.softDelete(id)],
    ['restore', (repo: SecureProductRepository, id: string) => repo.restore(id)],
  ] as const)('rejects cross-tenant %s', async (method, mutate) => {
    if (method === 'restore') await ds.getRepository(SecureScopedProduct).softDelete(b.id);
    await expect(mutate(tenantA, b.id)).rejects.toBeInstanceOf(NotFoundException);
    const row = await ds.getRepository(SecureScopedProduct).findOne({ where: { id: b.id }, withDeleted: true });
    expect(row).not.toBeNull();
    if (method === 'softDelete') expect(row?.deletedAt).toBeNull();
    if (method === 'restore') expect(row?.deletedAt).not.toBeNull();
  });

  it.each([
    ['delete', (repo: SecureProductRepository, id: string) => repo.delete(id), /^DELETE /i],
    ['softDelete', (repo: SecureProductRepository, id: string) => repo.softDelete(id), /^UPDATE /i],
    ['restore', (repo: SecureProductRepository, id: string) => repo.restore(id), /^UPDATE /i],
  ] as const)('puts both id and mapped scope column in an in-scope %s statement', async (method, mutate, sqlPattern) => {
    if (method === 'restore') await ds.getRepository(SecureScopedProduct).softDelete(a.id);
    queries.length = 0;
    await mutate(tenantA, a.id);
    const sql = queries.find((query) => sqlPattern.test(query.trim()));
    expect(sql).toContain('"tenant_code"');
    expect(sql).toContain('"id"');
  });

  it('rolls back a mixed-tenant batch instead of partially deleting it', async () => {
    await expect(tenantA.delete([a.id, b.id])).rejects.toBeInstanceOf(NotFoundException);
    expect(await ds.getRepository(SecureScopedProduct).count()).toBe(2);
  });

  it('rejects a caller-owned mutation runner unless its transaction is active', async () => {
    const runner = ds.createQueryRunner();
    await runner.connect();
    try {
      await expect(tenantA.delete([a.id, b.id], runner)).rejects.toBeInstanceOf(InactiveMutationTransactionError);
      expect(await ds.getRepository(SecureScopedProduct).count()).toBe(2);
    } finally {
      await runner.release();
    }
  });

  it('rejects create and import with an inactive caller-owned runner before either can write', async () => {
    const runner = ds.createQueryRunner();
    await runner.connect();
    try {
      await expect(tenantA.create({ name: 'inactive-create' }, runner)).rejects.toBeInstanceOf(InactiveMutationTransactionError);
      await expect(tenantA.import([{ name: 'inactive-import' }], runner)).rejects.toBeInstanceOf(InactiveMutationTransactionError);
      expect(await ds.getRepository(SecureScopedProduct).count()).toBe(2);
    } finally {
      await runner.release();
    }
  });

  it('allows an in-scope update and never lets the patch move the row to another tenant', async () => {
    const updated = await tenantA.update({ id: a.id, name: 'A2' });
    expect(updated.name).toBe('A2');
    await expect(tenantA.update({ id: a.id, tenantCode: 'B' })).rejects.toThrow('scope');
    expect((await ds.getRepository(SecureScopedProduct).findOneByOrFail({ id: a.id })).tenantCode).toBe('A');
  });
});

describe('fail-closed tenancy context', () => {
  let ds: DataSource;

  beforeEach(async () => {
    ({ ds } = await createDataSource([SecureScopedProduct]));
    await ds.getRepository(SecureScopedProduct).save({ name: 'A', tenantCode: 'A' });
  });

  afterEach(async () => ds.destroy());

  it('rejects a scoped entity when no tenancy strategy is configured', async () => {
    await expect(new SecureProductRepository(ds).all()).rejects.toBeInstanceOf(MissingTenancyContextError);
  });

  it.each([undefined, null])('rejects missing required scope value %p', async (tenantCode) => {
    const repo = new SecureProductRepository(ds, { tenancyStrategy: strategy({ tenantCode }) });
    await expect(repo.paging({ pageNumber: 0, pageSize: 10 })).rejects.toBeInstanceOf(MissingTenancyScopeError);
  });

  it.each(['', '   '])('rejects blank required scope value %p', async (tenantCode) => {
    const repo = new SecureProductRepository(ds, { tenancyStrategy: strategy({ tenantCode }) });
    await expect(repo.all()).rejects.toBeInstanceOf(InvalidTenancyScopeError);
  });

  it('rejects blank entries inside an allowed scope set', async () => {
    const repo = new SecureProductRepository(ds, { tenancyStrategy: strategy({ tenantCode: ['A', ' '] }) });
    await expect(repo.all()).rejects.toBeInstanceOf(InvalidTenancyScopeError);
  });

  it('treats an empty allowed-values scope as match-zero for reads and mutations', async () => {
    const repo = new SecureProductRepository(ds, { tenancyStrategy: strategy({ tenantCode: [] }) });
    expect((await repo.paging({ pageNumber: 0, pageSize: 10 })).total).toBe(0);
    const row = await ds.getRepository(SecureScopedProduct).findOneByOrFail({ tenantCode: 'A' });
    await expect(repo.delete(row.id)).rejects.toBeInstanceOf(NotFoundException);
    expect(await ds.getRepository(SecureScopedProduct).count()).toBe(1);
  });

  it('treats an empty optional allowed-values scope as match-zero when that dimension is supplied', async () => {
    const repo = new SecureProductRepository(ds, {
      tenancyStrategy: strategy({ tenantCode: 'A', departmentCode: [] }),
    });
    expect(await repo.all()).toEqual([]);
  });

  it('rejects a null scope object returned by the strategy', async () => {
    const repo = new SecureProductRepository(ds, {
      tenancyStrategy: strategy({}, { getCurrentScope: () => null as never }),
    });
    await expect(repo.all()).rejects.toBeInstanceOf(MissingTenancyScopeError);
  });

  it('rejects create and import before SQL when required scope is missing', async () => {
    const repo = new SecureProductRepository(ds, { tenancyStrategy: strategy({}) });
    await expect(repo.create({ name: 'missing' })).rejects.toBeInstanceOf(MissingTenancyScopeError);
    await expect(repo.import([{ name: 'missing-1' }, { name: 'missing-2' }])).rejects.toBeInstanceOf(MissingTenancyScopeError);
    expect(await ds.getRepository(SecureScopedProduct).count()).toBe(1);
  });

  it('permits an absent optional scope while enforcing the required tenant', async () => {
    const repo = new SecureProductRepository(ds, { tenancyStrategy: strategy({ tenantCode: 'A' }) });
    const created = await repo.create({ name: 'optional-department' });
    expect(created).toMatchObject({ tenantCode: 'A' });
    expect(created.departmentCode).toBeNull();
  });

  it('overrides caller scope on create and validates every import row before inserting', async () => {
    const repo = new SecureProductRepository(ds, { tenancyStrategy: strategy({ tenantCode: 'A' }) });
    const created = await repo.create({ name: 'caller-forged', tenantCode: 'B' });
    expect(created.tenantCode).toBe('A');

    await repo.import([
      { name: 'import-forged-1', tenantCode: 'B' },
      { name: 'import-forged-2', tenantCode: 'B' },
    ]);
    const imported = await ds.getRepository(SecureScopedProduct).findBy({ tenantCode: 'A' });
    expect(imported.map((row) => row.name)).toEqual(expect.arrayContaining(['import-forged-1', 'import-forged-2']));
    expect(await ds.getRepository(SecureScopedProduct).countBy({ tenantCode: 'B' })).toBe(0);
  });

  it('requires a selected write scope when several values are allowed, including optional dimensions', async () => {
    const repo = new SecureProductRepository(ds, {
      tenancyStrategy: strategy({ tenantCode: ['A', 'B'], departmentCode: ['D1', 'D2'] }),
    });
    await expect(repo.create({ name: 'ambiguous', tenantCode: 'A' })).rejects.toBeInstanceOf(InvalidTenancyScopeError);
    await expect(repo.create({ name: 'forged', tenantCode: 'C', departmentCode: 'D1' })).rejects.toBeInstanceOf(InvalidTenancyScopeError);
    const selected = await repo.create({ name: 'selected', tenantCode: 'A', departmentCode: 'D2' });
    expect(selected).toMatchObject({ tenantCode: 'A', departmentCode: 'D2' });
  });

  it('rejects a legacy boolean bypass and a forged structured grant', async () => {
    const legacy = new SecureProductRepository(ds, {
      tenancyStrategy: strategy({}, { shouldBypass: () => true }),
    });
    await expect(legacy.all()).rejects.toBeInstanceOf(UnauthorizedTenancyBypassError);

    const forged = new SecureProductRepository(ds, {
      tenancyStrategy: strategy({}, { getBypassGrant: () => ({ authorized: false }) as unknown as TenancyBypassGrant }),
    });
    await expect(forged.all()).rejects.toBeInstanceOf(UnauthorizedTenancyBypassError);
  });

  it('allows and audits an explicit authorized bypass grant', async () => {
    const audit = jest.fn();
    const grant: TenancyBypassGrant = {
      authorized: true,
      actorId: 'admin-1',
      reason: 'incident-support',
      allowedTargets: ['secure_scoped_product'],
      allowedOperations: ['read'],
      audit,
    };
    const repo = new SecureProductRepository(ds, {
      tenancyStrategy: strategy({}, { getBypassGrant: () => grant }),
    });
    expect(await repo.all()).toHaveLength(1);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ actorId: 'admin-1', reason: 'incident-support', operation: 'read' }));
  });

  it('rejects a valid grant outside its explicit target or operation allowlist', async () => {
    const audit = jest.fn();
    const repo = new SecureProductRepository(ds, {
      tenancyStrategy: strategy(
        {},
        {
          getBypassGrant: () => ({
            authorized: true,
            actorId: 'admin-1',
            reason: 'read-only support',
            allowedTargets: ['DifferentEntity'],
            allowedOperations: ['read'],
            audit,
          }),
        },
      ),
    });
    await expect(repo.all()).rejects.toBeInstanceOf(UnauthorizedTenancyBypassError);
    expect(audit).not.toHaveBeenCalled();

    const updateOnly = new SecureProductRepository(ds, {
      tenancyStrategy: strategy(
        {},
        {
          getBypassGrant: () => ({
            authorized: true,
            actorId: 'admin-1',
            reason: 'update-only support',
            allowedTargets: ['secure_scoped_product'],
            allowedOperations: ['update'],
            audit,
          }),
        },
      ),
    });
    await expect(updateOnly.all()).rejects.toBeInstanceOf(UnauthorizedTenancyBypassError);
    expect(audit).not.toHaveBeenCalled();
  });

  it('rejects an async audit callback because bypass cannot precede audit completion', async () => {
    const audit = jest.fn(async () => undefined);
    const grant: TenancyBypassGrant = {
      authorized: true,
      actorId: 'admin-1',
      reason: 'incident-support',
      allowedTargets: ['secure_scoped_product'],
      allowedOperations: ['read'],
      audit,
    };
    const repo = new SecureProductRepository(ds, {
      tenancyStrategy: strategy({}, { getBypassGrant: () => grant }),
    });
    await expect(repo.all()).rejects.toBeInstanceOf(UnauthorizedTenancyBypassError);
    expect(audit).toHaveBeenCalledTimes(1);
  });
});

describe('scoped relations', () => {
  let ds: DataSource;

  beforeEach(async () => {
    ({ ds } = await createDataSource([SecureScopedProduct, SecureScopedChild, SecureScopedParent]));
  });

  afterEach(async () => ds.destroy());

  it('does not hydrate a related entity from another tenant in paging or detail', async () => {
    const childB = await ds.getRepository(SecureScopedChild).save({ name: 'B-child', tenantCode: 'B' });
    const parentA = await ds.getRepository(SecureScopedParent).save({ name: 'A-parent', tenantCode: 'A', child: childB });
    const repo = new SecureParentRepository(ds, { tenancyStrategy: strategy({ tenantCode: 'A' }) });

    const page = await repo.paging({ pageNumber: 0, pageSize: 10 }, { relations: ['child'] });
    expect(page.items).toHaveLength(1);
    expect(page.items[0].child).toBeNull();

    const detail = await repo.detail(parentA.id, { relations: ['child'] });
    expect(detail?.child).toBeNull();
  });
});
