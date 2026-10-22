import type { DeepPartial, EntityTarget, ObjectLiteral, QueryRunner } from 'typeorm';
import type { Filter, PagingReq, PagingRes } from '@sdcorejs/utils/models';
import type { BaseRepositoryArgs } from './types/repository-args.types';

/**
 * Public surface of `BaseRepository`. Useful for DI-based mocking and ergonomic generics
 * in services that accept any concrete repository subclass.
 */
export interface IBaseRepository<T extends ObjectLiteral> {
  readonly target: EntityTarget<T>;

  /** Optional read runners must belong to this DataSource and have an active caller-owned transaction. */
  paging(req: PagingReq<T>, args?: BaseRepositoryArgs<T>, qr?: QueryRunner): Promise<PagingRes<T>>;
  pagingDeleted(req: PagingReq<T>, args?: BaseRepositoryArgs<T>, qr?: QueryRunner): Promise<PagingRes<T>>;
  all(filters?: Filter<T>[], args?: BaseRepositoryArgs<T>, qr?: QueryRunner): Promise<T[]>;
  search(keyword: string, filters?: Filter<T>[], qr?: QueryRunner): Promise<T[]>;
  detail(id: string, args?: BaseRepositoryArgs<T>, qr?: QueryRunner): Promise<T | null>;
  /** Find the authorized subset of unique ids using the repository's active tenancy scope. */
  findByIds(ids: string[], args?: BaseRepositoryArgs<T>, qr?: QueryRunner): Promise<T[]>;

  create(entity: DeepPartial<T>, qr?: QueryRunner): Promise<T>;
  update(entity: DeepPartial<T>, qr?: QueryRunner): Promise<T>;
  delete(id: string | string[], qr?: QueryRunner): Promise<boolean>;
  softDelete(id: string | string[], qr?: QueryRunner): Promise<boolean>;
  restore(id: string | string[], qr?: QueryRunner): Promise<boolean>;
  import(entities: DeepPartial<T>[], qr?: QueryRunner): Promise<T[]>;
}
