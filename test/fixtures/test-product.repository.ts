import type { DataSource } from 'typeorm';
import { BaseRepository } from '../../src/core/orm/base-repository';
import { TestProduct } from './test-product.entity';

export class TestProductRepository extends BaseRepository<TestProduct> {
  constructor(ds: DataSource) {
    super(TestProduct, ds);
  }
}
