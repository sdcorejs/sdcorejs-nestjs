import type { DeepPartial, EntityTarget, ObjectLiteral, QueryRunner, Repository } from 'typeorm';
import type { Filter, PagingReq, PagingRes } from '@sdcorejs/utils/models';
import type { BaseRepositoryArgs } from './types/repository-args.types';

/**
 * Public surface of `BaseRepository`. Useful for DI-based mocking and ergonomic generics
 * in services that accept any concrete repository subclass.
 */
export interface IBaseRepository<T extends ObjectLiteral> {
  readonly queryRunner: QueryRunner;
  readonly repository: Repository<T>;
  readonly target: EntityTarget<T>;
  getRepository(qr?: QueryRunner): Repository<T>;

  paging(req: PagingReq<T>, args?: BaseRepositoryArgs<T>): Promise<PagingRes<T>>;
  pagingDeleted(req: PagingReq<T>, args?: BaseRepositoryArgs<T>): Promise<PagingRes<T>>;
  all(filters?: Filter<T>[], args?: BaseRepositoryArgs<T>): Promise<T[]>;
  search(keyword: string, filters?: Filter<T>[]): Promise<T[]>;
  detail(id: string, args?: BaseRepositoryArgs<T>): Promise<T | null>;

  create(entity: DeepPartial<T>, qr?: QueryRunner): Promise<T>;
  update(entity: DeepPartial<T>, qr?: QueryRunner): Promise<T>;
  delete(id: string | string[], qr?: QueryRunner): Promise<boolean>;
  softDelete(id: string | string[], qr?: QueryRunner): Promise<boolean>;
  restore(id: string | string[], qr?: QueryRunner): Promise<boolean>;
  import(entities: DeepPartial<T>[], qr?: QueryRunner): Promise<T[]>;
}
