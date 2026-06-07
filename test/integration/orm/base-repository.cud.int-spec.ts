import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { createTestDataSource } from '../../fixtures/pg-mem-datasource';
import { TestProduct } from '../../fixtures/test-product.entity';
import { TestProductRepository } from '../../fixtures/test-product.repository';

describe('BaseRepository CUD + uuid validation', () => {
  let ds: DataSource;
  let repo: TestProductRepository;

  beforeEach(async () => {
    ds = await createTestDataSource([TestProduct]);
    repo = new TestProductRepository(ds);
  });
  afterEach(async () => {
    await ds.destroy();
  });

  it('create saves and returns entity with generated id', async () => {
    const e = await repo.create({ code: 'C-1', name: 'New' });
    expect(e.id).toBeDefined();
    expect(e.code).toBe('C-1');
  });

  it('update changes fields and returns updated entity', async () => {
    const e = await repo.create({ code: 'U-1', name: 'Original' });
    const updated = await repo.update({ id: e.id, name: 'Renamed' });
    expect(updated.name).toBe('Renamed');
  });

  it('delete by id (string) hard-removes', async () => {
    const e = await repo.create({ code: 'D-1', name: 'Doomed' });
    const ok = await repo.delete(e.id);
    expect(ok).toBe(true);
    const after = await ds.getRepository(TestProduct).findOne({ where: { id: e.id }, withDeleted: true });
    expect(after).toBeNull();
  });

  it('delete by ids (array) bulk-removes', async () => {
    const a = await repo.create({ code: 'D-A' });
    const b = await repo.create({ code: 'D-B' });
    const ok = await repo.delete([a.id, b.id]);
    expect(ok).toBe(true);
  });

  it('softDelete sets deletedAt; paging excludes it', async () => {
    const e = await repo.create({ code: 'S-1' });
    const ok = await repo.softDelete(e.id);
    expect(ok).toBe(true);
    const r = await repo.paging({ pageNumber: 0, pageSize: 10 });
    expect(r.total).toBe(0);
  });

  it('restore clears deletedAt', async () => {
    const e = await repo.create({ code: 'R-1' });
    await repo.softDelete(e.id);
    const ok = await repo.restore(e.id);
    expect(ok).toBe(true);
    const r = await repo.paging({ pageNumber: 0, pageSize: 10 });
    expect(r.total).toBe(1);
  });

  it('import bulk-inserts and returns rows', async () => {
    const out = await repo.import([{ code: 'I-1' }, { code: 'I-2' }, { code: 'I-3' }]);
    expect(out).toHaveLength(3);
    const r = await repo.paging({ pageNumber: 0, pageSize: 10 });
    expect(r.total).toBe(3);
  });

  it('import returns [] for empty input', async () => {
    expect(await repo.import([])).toEqual([]);
  });

  it('detail validates uuid input', async () => {
    await expect(repo.detail('not-a-uuid')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('detail returns null for unknown uuid', async () => {
    const result = await repo.detail('00000000-0000-4000-a000-000000000000');
    expect(result).toBeNull();
  });

  it('detail returns entity for known uuid', async () => {
    const e = await repo.create({ code: 'F-1' });
    const found = await repo.detail(e.id);
    expect(found?.code).toBe('F-1');
  });
});
