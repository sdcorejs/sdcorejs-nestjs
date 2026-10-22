import 'reflect-metadata';
import type { DataSource, QueryRunner } from 'typeorm';
import { BaseRepository } from './base-repository';
import { createTestDataSource } from '../../../test/fixtures/pg-mem-datasource';
import { TestProduct } from '../../../test/fixtures/test-product.entity';
import { TestProductRepository } from '../../../test/fixtures/test-product.repository';
import type { BaseRepositoryArgs } from './types/repository-args.types';
import type { Filter, PagingReq } from '@sdcorejs/utils/models';

// Explicit future signature keeps the fail-before test executable against the previous API.
interface ReadApi {
  paging(req: PagingReq<TestProduct>, args?: BaseRepositoryArgs<TestProduct>, qr?: QueryRunner): Promise<unknown>;
  pagingDeleted(req: PagingReq<TestProduct>, args?: BaseRepositoryArgs<TestProduct>, qr?: QueryRunner): Promise<unknown>;
  all(filters?: Filter<TestProduct>[], args?: BaseRepositoryArgs<TestProduct>, qr?: QueryRunner): Promise<unknown>;
  search(keyword: string, filters?: Filter<TestProduct>[], qr?: QueryRunner): Promise<unknown>;
  detail(id: string, args?: BaseRepositoryArgs<TestProduct>, qr?: QueryRunner): Promise<unknown>;
  findByIds(ids: string[], args?: BaseRepositoryArgs<TestProduct>, qr?: QueryRunner): Promise<unknown>;
}
const id = '00000000-0000-4000-8000-000000000001';
const reads: Array<[string, (repo: ReadApi, qr: QueryRunner) => Promise<unknown>]> = [
  ['paging', (r, qr) => r.paging({ pageNumber: 0 }, undefined, qr)],
  ['pagingDeleted', (r, qr) => r.pagingDeleted({ pageNumber: 0 }, undefined, qr)],
  ['all', (r, qr) => r.all(undefined, undefined, qr)],
  ['search', (r, qr) => r.search('A', undefined, qr)],
  ['UUID search', (r, qr) => r.search(id, undefined, qr)],
  ['detail', (r, qr) => r.detail(id, undefined, qr)],
  ['invalid UUID detail', (r, qr) => r.detail('invalid', undefined, qr)],
  ['findByIds', (r, qr) => r.findByIds([id], undefined, qr)],
  ['empty findByIds', (r, qr) => r.findByIds([], undefined, qr)],
];
class Repository extends BaseRepository<TestProduct> {}

describe('caller-owned read QueryRunner contract', () => {
  const invalidRunners: Array<[string, (ds: DataSource) => unknown]> = [
    ['null', () => null],
    ['false', () => false],
    ['forged', () => ({})],
    ['foreign datasource', () => ({ connection: {} })],
    ['foreign manager', (ds) => ({ connection: ds, manager: { connection: {} } })],
    ['unbound manager', (ds) => ({ connection: ds, manager: { connection: ds } })],
    ['released', (ds) => runner(ds, true, true)],
    ['inactive', (ds) => runner(ds, false, false)],
    ['missing active flag', (ds) => runner(ds, false, undefined)],
  ];
  function runner(ds: DataSource, released: boolean, active: boolean | undefined) {
    const qr = { connection: ds, isReleased: released, isTransactionActive: active, manager: {} };
    qr.manager = { connection: ds, queryRunner: qr };
    return qr;
  }

  describe.each(invalidRunners)('%s', (_name, makeRunner) => {
    it.each(reads)('rejects %s before any repository access', async (_read, call) => {
      const ds = {
        getRepository: jest.fn(() => {
          throw new Error('Unexpected repository access');
        }),
      } as unknown as DataSource;
      const repo = new Repository(TestProduct, ds);
      await expect(call(repo as unknown as ReadApi, makeRunner(ds) as QueryRunner)).rejects.toMatchObject({
        response: {
          code: 'core.repository.invalid-query-runner',
          message: 'A read QueryRunner must belong to this DataSource and have an active transaction',
        },
      });
      expect(ds.getRepository).not.toHaveBeenCalled();
    });
  });

  it('validates a runner before the no-search-metadata early return', async () => {
    class NoSearch {}
    const ds = { getRepository: jest.fn() } as unknown as DataSource;
    class NoSearchRepository extends BaseRepository<NoSearch> {}
    const repo = new NoSearchRepository(NoSearch, ds) as unknown as ReadApi;
    await expect(repo.search('anything', undefined, null as unknown as QueryRunner)).rejects.toMatchObject({
      response: { code: 'core.repository.invalid-query-runner' },
    });
    expect(ds.getRepository).not.toHaveBeenCalled();
  });

  describe('valid transaction manager', () => {
    let ds: DataSource;
    let qr: QueryRunner;
    beforeEach(async () => {
      ds = await createTestDataSource([TestProduct]);
      await ds.getRepository(TestProduct).save({ id, code: 'A', name: 'Alpha', isActive: true });
      qr = ds.createQueryRunner();
      await qr.startTransaction();
    });
    afterEach(async () => {
      jest.restoreAllMocks();
      if (qr.isTransactionActive) await qr.rollbackTransaction();
      await qr.release();
      await ds.destroy();
    });
    it.each(reads.filter(([name]) => name !== 'invalid UUID detail'))(
      'routes %s through caller manager without lifecycle changes',
      async (_name, call) => {
        const repo = new TestProductRepository(ds) as unknown as ReadApi;
        const global = jest.spyOn(ds, 'getRepository').mockImplementation(() => {
          throw new Error('Global repository forbidden');
        });
        const manager = jest.spyOn(qr.manager, 'getRepository');
        const lifecycle = ['startTransaction', 'commitTransaction', 'rollbackTransaction', 'release'] as const;
        const spies = lifecycle.map((method) => jest.spyOn(qr, method));
        await call(repo, qr);
        expect(global).not.toHaveBeenCalled();
        if (_name !== 'empty findByIds') expect(manager).toHaveBeenCalledWith(TestProduct);
        spies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
        expect(qr.isTransactionActive).toBe(true);
        expect(qr.isReleased).toBe(false);
      },
    );
    it('propagates query failure without ending the caller transaction', async () => {
      const error = new Error('synthetic query failure');
      jest.spyOn(qr.manager, 'getRepository').mockImplementation(() => {
        throw error;
      });
      const repo = new TestProductRepository(ds) as unknown as ReadApi;
      await expect(repo.all(undefined, undefined, qr)).rejects.toBe(error);
      expect(qr.isTransactionActive).toBe(true);
      expect(qr.isReleased).toBe(false);
    });
  });
});
