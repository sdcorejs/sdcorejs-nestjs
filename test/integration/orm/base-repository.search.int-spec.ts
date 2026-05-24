import 'reflect-metadata';
import { Column, Entity, type DataSource } from 'typeorm';
import { createTestDataSource } from '../../fixtures/pg-mem-datasource';
import { TestProduct } from '../../fixtures/test-product.entity';
import { TestProductRepository } from '../../fixtures/test-product.repository';
import { BaseEntity } from '../../../src/orm/base-entity';
import { BaseRepository } from '../../../src/orm/base-repository';

@Entity('plain_no_search')
class NoSearchEntity extends BaseEntity {
  @Column({ nullable: true })
  name?: string;
}

class NoSearchRepo extends BaseRepository<NoSearchEntity> {
  constructor(ds: DataSource) {
    super(NoSearchEntity, ds);
  }
}

describe('BaseRepository.search', () => {
  let ds: DataSource;
  let repo: TestProductRepository;

  beforeEach(async () => {
    ds = await createTestDataSource([TestProduct, NoSearchEntity]);
    repo = new TestProductRepository(ds);
    await ds.getRepository(TestProduct).save([
      { code: 'SKU-1', name: 'Apple iPhone', isActive: true },
      { code: 'SKU-2', name: 'Apple MacBook', isActive: true },
      { code: 'SKU-3', name: 'Samsung Phone', isActive: false },
    ]);
  });
  afterEach(async () => {
    await ds.destroy();
  });

  it('uuid input returns single row by id, bypassing filters', async () => {
    const [first] = await ds.getRepository(TestProduct).find();
    const items = await repo.search(first.id);
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe(first.id);
  });

  it('returns [] when entity has no @SearchableFields decorator', async () => {
    const noSearch = new NoSearchRepo(ds);
    const items = await noSearch.search('anything');
    expect(items).toEqual([]);
  });

  it('exact-matches code', async () => {
    const items = await repo.search('SKU-1');
    expect(items).toHaveLength(1);
  });

  it('contains-matches name and respects activeColumn', async () => {
    const items = await repo.search('apple');
    expect(items.map((r) => r.code).sort()).toEqual(['SKU-1', 'SKU-2']);
  });

  it('does not surface inactive rows via contain-match', async () => {
    const items = await repo.search('Samsung');
    expect(items).toHaveLength(0);
  });
});
