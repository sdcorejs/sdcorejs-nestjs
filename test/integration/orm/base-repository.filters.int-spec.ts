import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { createTestDataSource } from '../../fixtures/pg-mem-datasource';
import { TestProduct } from '../../fixtures/test-product.entity';
import { TestProductRepository } from '../../fixtures/test-product.repository';

describe('BaseRepository.paging filters', () => {
  let ds: DataSource;
  let repo: TestProductRepository;

  beforeEach(async () => {
    ds = await createTestDataSource([TestProduct]);
    repo = new TestProductRepository(ds);
    await ds.getRepository(TestProduct).save([
      { code: 'P-100', name: 'Phone X', price: 100, isActive: true, attributes: { color: 'red', stock: 5 } },
      { code: 'P-200', name: 'Phone Y', price: 200, isActive: true, attributes: { color: 'blue', stock: 10 } },
      { code: 'L-300', name: 'Laptop A', price: 300, isActive: false, attributes: { color: 'red', stock: 0 } },
      { code: 'L-400', name: 'Laptop B', price: 400, isActive: true, attributes: { color: 'green', stock: 3 } },
    ]);
  });
  afterEach(async () => {
    await ds.destroy();
  });

  const filter = async (...filters: Parameters<typeof repo.paging>[0]['filters']) => {
    const r = await repo.paging({ pageNumber: 0, pageSize: 100, filters });
    return r.items;
  };

  it('EQUAL matches exactly', async () => {
    const items = await filter({ field: 'code', operator: 'EQUAL', data: 'P-100' });
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe('Phone X');
  });

  it('NOT_EQUAL excludes match', async () => {
    const items = await filter({ field: 'code', operator: 'NOT_EQUAL', data: 'P-100' });
    expect(items).toHaveLength(3);
  });

  it('LESS_THAN / GREATER_THAN numeric', async () => {
    expect(await filter({ field: 'price', operator: 'LESS_THAN', data: 250 })).toHaveLength(2);
    expect(await filter({ field: 'price', operator: 'GREATER_THAN', data: 200 })).toHaveLength(2);
  });

  it('LESS_OR_EQUAL / GREATER_OR_EQUAL inclusive', async () => {
    expect(await filter({ field: 'price', operator: 'LESS_OR_EQUAL', data: 200 })).toHaveLength(2);
    expect(await filter({ field: 'price', operator: 'GREATER_OR_EQUAL', data: 300 })).toHaveLength(2);
  });

  it('CONTAIN matches substring (case-insensitive)', async () => {
    const items = await filter({ field: 'name', operator: 'CONTAIN', data: 'phone' });
    expect(items).toHaveLength(2);
  });

  it('NOT_CONTAIN excludes substring matches', async () => {
    const items = await filter({ field: 'name', operator: 'NOT_CONTAIN', data: 'phone' });
    expect(items).toHaveLength(2);
  });

  it('START_WITH / END_WITH / NOT_START_WITH / NOT_END_WITH', async () => {
    expect(await filter({ field: 'code', operator: 'START_WITH', data: 'P-' })).toHaveLength(2);
    expect(await filter({ field: 'code', operator: 'NOT_START_WITH', data: 'P-' })).toHaveLength(2);
    expect(await filter({ field: 'code', operator: 'END_WITH', data: '00' })).toHaveLength(4);
    expect(await filter({ field: 'code', operator: 'NOT_END_WITH', data: '100' })).toHaveLength(3);
  });

  it('BETWEEN inclusive', async () => {
    const items = await filter({ field: 'price', operator: 'BETWEEN', data: { from: 200, to: 300 } });
    expect(items).toHaveLength(2);
  });

  it('IN / NOT_IN list', async () => {
    expect(await filter({ field: 'code', operator: 'IN', data: ['P-100', 'L-300'] })).toHaveLength(2);
    expect(await filter({ field: 'code', operator: 'NOT_IN', data: ['P-100', 'L-300'] })).toHaveLength(2);
  });

  it('NULL / NOT_NULL for nullable column', async () => {
    await ds.getRepository(TestProduct).update({ code: 'P-100' }, { name: null as unknown as string });
    expect(await filter({ field: 'name', operator: 'NULL' })).toHaveLength(1);
    expect(await filter({ field: 'name', operator: 'NOT_NULL' })).toHaveLength(3);
  });

  it('AND group combines conditions', async () => {
    const items = await filter({
      operator: 'AND',
      data: [
        { field: 'isActive', operator: 'EQUAL', data: true },
        { field: 'price', operator: 'GREATER_THAN', data: 150 },
      ],
    });
    expect(items.map((r) => r.code).sort()).toEqual(['L-400', 'P-200']);
  });

  it('OR group expands', async () => {
    const items = await filter({
      operator: 'OR',
      data: [
        { field: 'code', operator: 'EQUAL', data: 'P-100' },
        { field: 'code', operator: 'EQUAL', data: 'L-400' },
      ],
    });
    expect(items).toHaveLength(2);
  });

  it('rejects field with non-alphanumeric chars (SQL injection guard)', async () => {
    await expect(
      repo.paging({
        pageNumber: 0,
        pageSize: 10,
        filters: [{ field: "name'; DROP TABLE--", operator: 'EQUAL', data: 'x' } as never],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects invalid sort field', async () => {
    await expect(
      repo.paging({
        pageNumber: 0,
        pageSize: 10,
        orders: [{ field: 'nonexistent', direction: 'ASC' } as never],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
