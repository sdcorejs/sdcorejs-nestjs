import 'reflect-metadata';
import type { DataSource } from 'typeorm';
import { createTestDataSource } from '../../fixtures/pg-mem-datasource';
import { TestProduct } from '../../fixtures/test-product.entity';
import { TestProductRepository } from '../../fixtures/test-product.repository';

describe('BaseRepository.paging', () => {
  let ds: DataSource;
  let repo: TestProductRepository;

  beforeEach(async () => {
    ds = await createTestDataSource([TestProduct]);
    repo = new TestProductRepository(ds);
    await ds.getRepository(TestProduct).save([
      { code: 'A1', name: 'Alpha', price: 100, isActive: true },
      { code: 'A2', name: 'Beta', price: 200, isActive: true },
      { code: 'A3', name: 'Gamma', price: 300, isActive: false },
      { code: 'A4', name: 'Delta', price: 400, isActive: true },
      { code: 'A5', name: 'Epsilon', price: 500, isActive: true },
    ]);
  });
  afterEach(async () => {
    await ds.destroy();
  });

  it('returns first page with total', async () => {
    const res = await repo.paging({ pageNumber: 0, pageSize: 2 });
    expect(res.items).toHaveLength(2);
    expect(res.total).toBe(5);
  });

  it('returns second page', async () => {
    const res = await repo.paging({ pageNumber: 1, pageSize: 2 });
    expect(res.items).toHaveLength(2);
    expect(res.total).toBe(5);
  });

  it('clamps pageNumber to >= 0', async () => {
    const res = await repo.paging({ pageNumber: -5, pageSize: 2 });
    expect(res.items).toHaveLength(2);
  });

  it('clamps pageSize to <= 1000', async () => {
    const res = await repo.paging({ pageNumber: 0, pageSize: 99999 });
    expect(res.items).toHaveLength(5);
    expect(res.total).toBe(5);
  });

  it('returns all rows when pageSize = 0', async () => {
    const items = await repo.all();
    expect(items).toHaveLength(5);
  });

  it('sorts ascending', async () => {
    const res = await repo.paging({
      pageNumber: 0,
      pageSize: 10,
      orders: [{ field: 'price', direction: 'ASC' }],
    });
    expect(res.items.map((r) => r.price)).toEqual([100, 200, 300, 400, 500]);
  });

  it('sorts descending', async () => {
    const res = await repo.paging({
      pageNumber: 0,
      pageSize: 10,
      orders: [{ field: 'price', direction: 'DESC' }],
    });
    expect(res.items.map((r) => r.price)).toEqual([500, 400, 300, 200, 100]);
  });

  it('excludes soft-deleted by default', async () => {
    const all = await ds.getRepository(TestProduct).find();
    const target = all[0];
    await ds.getRepository(TestProduct).softDelete(target.id);
    const res = await repo.paging({ pageNumber: 0, pageSize: 10 });
    expect(res.total).toBe(4);
  });

  it('includes soft-deleted with pagingDeleted', async () => {
    const all = await ds.getRepository(TestProduct).find();
    await ds.getRepository(TestProduct).softDelete(all[0].id);
    const res = await repo.pagingDeleted({ pageNumber: 0, pageSize: 10 });
    expect(res.total).toBe(5);
  });
});
