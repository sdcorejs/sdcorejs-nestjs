import 'reflect-metadata';
import { Column, Entity, type DataSource } from 'typeorm';
import { createTestDataSource } from '../../fixtures/pg-mem-datasource';
import { BaseEntity } from '../../../src/orm/base-entity';
import { WithAudit, WithTimestamps } from '../../../src/orm/mixins';
import { BaseRepository } from '../../../src/orm/base-repository';
import { ContextService } from '../../../src/context/context.service';
import { DefaultAuditStrategy } from '../../../src/audit/default-audit.strategy';
import type { IAuditStrategy } from '../../../src/audit/strategy.interface';

@Entity('audit_product')
class AuditProduct extends WithAudit(BaseEntity) {
  @Column() name!: string;
}

@Entity('ts_only_product')
class TsOnlyProduct extends WithTimestamps(BaseEntity) {
  @Column() name!: string;
}

class AuditRepo extends BaseRepository<AuditProduct> {
  constructor(ds: DataSource, opts: ConstructorParameters<typeof BaseRepository>[2]) {
    super(AuditProduct, ds, opts);
  }
}
class TsOnlyRepo extends BaseRepository<TsOnlyProduct> {
  constructor(ds: DataSource, opts: ConstructorParameters<typeof BaseRepository>[2]) {
    super(TsOnlyProduct, ds, opts);
  }
}

describe('BaseRepository audit integration', () => {
  let ds: DataSource;
  let ctx: ContextService;

  beforeEach(async () => {
    ds = await createTestDataSource([AuditProduct, TsOnlyProduct]);
    ctx = new ContextService();
  });
  afterEach(async () => {
    await ds.destroy();
  });

  it('no auditStrategy → no audit fields filled', async () => {
    const repo = new AuditRepo(ds, undefined);
    const e = await repo.create({ name: 'X' });
    expect(e.createdBy).toBeNull();
  });

  it('with DefaultAuditStrategy + ctx → fills createdBy + modifier snapshot on create', async () => {
    const strategy = new DefaultAuditStrategy(ctx);
    const repo = new AuditRepo(ds, { auditStrategy: strategy, contextService: ctx });
    await ctx.run(
      { userId: '00000000-0000-4000-a000-000000000001', username: 'nghia', fullName: 'Nghia Tran', permissions: [] },
      async () => {
        const e = await repo.create({ name: 'X' });
        expect(e.createdBy).toBe('00000000-0000-4000-a000-000000000001');
        expect(e.creator).toEqual({ id: '00000000-0000-4000-a000-000000000001', username: 'nghia', fullName: 'Nghia Tran' });
        expect(e.modifiedBy).toBe('00000000-0000-4000-a000-000000000001');
      },
    );
  });

  it('skips audit fill when ctx.userId is undefined', async () => {
    const strategy = new DefaultAuditStrategy(ctx);
    const repo = new AuditRepo(ds, { auditStrategy: strategy, contextService: ctx });
    const e = await repo.create({ name: 'X' });
    expect(e.createdBy).toBeNull();
    expect(e.modifiedBy).toBeNull();
  });

  it('WithTimestamps-only entity gets timestamps but no audit user fields', async () => {
    const strategy = new DefaultAuditStrategy(ctx);
    const repo = new TsOnlyRepo(ds, { auditStrategy: strategy, contextService: ctx });
    await ctx.run({ userId: '00000000-0000-4000-a000-000000000001', username: 'n', fullName: 'N' }, async () => {
      const e = await repo.create({ name: 'X' });
      expect(e.createdAt).toBeDefined();
      // No createdBy/modifier columns exist on this entity.
      expect((e as { createdBy?: string }).createdBy).toBeUndefined();
    });
  });

  it('update fires onUpdate (modifiedBy updated, createdBy unchanged)', async () => {
    const strategy = new DefaultAuditStrategy(ctx);
    const repo = new AuditRepo(ds, { auditStrategy: strategy, contextService: ctx });
    const created = await ctx.run(
      { userId: '00000000-0000-4000-a000-000000000001', username: 'a', fullName: 'A' },
      async () => repo.create({ name: 'orig' }),
    );
    await ctx.run(
      { userId: '00000000-0000-4000-a000-000000000002', username: 'b', fullName: 'B' },
      async () => repo.update({ id: created.id, name: 'changed' } as never),
    );
    const reloaded = await ds.getRepository(AuditProduct).findOneBy({ id: created.id });
    expect(reloaded?.createdBy).toBe('00000000-0000-4000-a000-000000000001');
    expect(reloaded?.modifiedBy).toBe('00000000-0000-4000-a000-000000000002');
  });
});

describe('Custom IAuditStrategy override', () => {
  it('user-supplied strategy replaces default behavior', async () => {
    const calls: string[] = [];
    const custom: IAuditStrategy = {
      onCreate: (e) => {
        calls.push('create');
        (e as Record<string, unknown>).createdBy = '00000000-0000-4000-a000-000000000099';
      },
      onUpdate: () => calls.push('update'),
      onSoftDelete: () => calls.push('soft'),
    };
    const ds = await createTestDataSource([AuditProduct]);
    const repo = new AuditRepo(ds, { auditStrategy: custom });
    const e = await repo.create({ name: 'X' });
    expect(calls).toEqual(['create']);
    expect(e.createdBy).toBe('00000000-0000-4000-a000-000000000099');
    await ds.destroy();
  });
});
