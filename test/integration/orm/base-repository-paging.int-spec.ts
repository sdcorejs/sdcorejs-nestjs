import 'reflect-metadata';
import { Column, Entity, type DataSource } from 'typeorm';
import { createTestDataSource } from '../../fixtures/pg-mem-datasource';
import { BaseEntity } from '../../../src/core/orm/base-entity';
import { BaseRepository } from '../../../src/core/orm/base-repository';

@Entity('paging_item')
class PagingItem extends BaseEntity {
  @Column({ type: 'int' })
  n!: number;
}

class PagingRepo extends BaseRepository<PagingItem> {
  constructor(ds: DataSource) {
    super(PagingItem, ds);
  }
}

describe('BaseRepository paging cap + all() (200-row hard cap)', () => {
  let ds: DataSource;
  let repo: PagingRepo;

  beforeEach(async () => {
    ds = await createTestDataSource([PagingItem]);
    repo = new PagingRepo(ds);
    await ds.getRepository(PagingItem).save(Array.from({ length: 205 }, (_, i) => ({ n: i })));
  });
  afterEach(async () => {
    await ds.destroy();
  });

  it('caps a page at MAX_PAGE_SIZE (200) even when a larger pageSize is requested', async () => {
    const res = await repo.paging({ pageNumber: 0, pageSize: 9999 });
    expect(res.total).toBe(205);
    expect(res.items).toHaveLength(BaseRepository.MAX_PAGE_SIZE);
    expect(BaseRepository.MAX_PAGE_SIZE).toBe(200);
  });

  it('defaults a missing or non-positive pageSize to 10 (paging is never unbounded)', async () => {
    expect((await repo.paging({ pageNumber: 0, pageSize: 0 })).items).toHaveLength(10);
    expect((await repo.paging({ pageNumber: 0 } as never)).items).toHaveLength(10);
  });

  it('all() returns every row (bypasses the paging cap)', async () => {
    expect(await repo.all()).toHaveLength(205);
  });
});
