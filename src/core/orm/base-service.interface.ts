import type { ObjectLiteral, QueryRunner, DeepPartial } from 'typeorm';
import type { Filter, PagingReq, PagingRes } from '@sdcorejs/utils/models';
import type { BaseRepositoryArgs } from './types/repository-args.types';
import type { Dto } from './types/dto.types';
import type { SchemaOptions, SchemaPropOptions } from './decorators/schema.decorator';

/**
 * Public surface of `BaseService`. Depend on this (not the concrete class) when a service is
 * provided/injected by an interface DI token — e.g. `@Inject(IMyService)` — so consumers can
 * swap implementations and so `BaseController` accepts any conforming service.
 */
export interface IBaseService<T extends ObjectLiteral, TDto extends Dto> {
  mapDTO(entity: T | undefined | null): TDto | undefined | null;

  paging(req: PagingReq<T>, args?: BaseRepositoryArgs<T>): Promise<PagingRes<TDto>>;
  pagingDeleted(req: PagingReq<T>, args?: BaseRepositoryArgs<T>): Promise<PagingRes<TDto>>;
  all(filters?: Filter<T>[], args?: BaseRepositoryArgs<T>): Promise<TDto[]>;
  search(keyword: string, filters?: Filter<T>[]): Promise<TDto[]>;
  detail(id: string, args?: BaseRepositoryArgs<T>): Promise<TDto | null>;

  create(entity: DeepPartial<T>, qr?: QueryRunner): Promise<T>;
  import(entities: DeepPartial<T>[]): Promise<T[]>;
  update(id: string, entity: DeepPartial<T>, qr?: QueryRunner): Promise<T>;
  delete(id: string): Promise<TDto[]>;
  softDelete(id: string): Promise<TDto[]>;
  restore(id: string): Promise<TDto[]>;

  schema(): { schema: SchemaOptions; props: Record<string, SchemaPropOptions>; fields: string[] };
}
