import { type FindOptionsWhere, In, type ObjectLiteral, type QueryRunner } from 'typeorm';
import type { DeepPartial } from 'typeorm';
import type { Filter, PagingReq, PagingRes } from '@sdcorejs/utils/models';
import type { IBaseRepository } from './base-repository.interface';
import type { IBaseService } from './base-service.interface';
import type { BaseRepositoryArgs } from './types/repository-args.types';
import type { Dto } from './types/dto.types';
import type { ClassRef } from './types/class-ref.types';
import { getSchema, getSchemaProps, type SchemaOptions, type SchemaPropOptions } from './decorators/schema.decorator';

/**
 * Generic service layer over a `BaseRepository`. Maps entities to DTOs via the abstract
 * `mapDTO` and enforces `deletable` / `restorable` filtering on destructive operations.
 *
 * Controllers stay thin — services own the business logic and DTO contract.
 */
export abstract class BaseService<T extends ObjectLiteral, TDto extends Dto> implements IBaseService<T, TDto> {
  constructor(protected readonly repository: IBaseRepository<T>) {}

  abstract mapDTO(entity: T | undefined | null): TDto | undefined | null;

  // --- READ ----------------------------------------------------------------

  async paging(req: PagingReq<T>, args?: BaseRepositoryArgs<T>): Promise<PagingRes<TDto>> {
    const { items, total } = await this.repository.paging(req, args);
    return { items: this.mapMany(items), total };
  }

  async pagingDeleted(req: PagingReq<T>, args?: BaseRepositoryArgs<T>): Promise<PagingRes<TDto>> {
    const { items, total } = await this.repository.pagingDeleted(req, args);
    return { items: this.mapMany(items), total };
  }

  async all(filters?: Filter<T>[], args?: BaseRepositoryArgs<T>): Promise<TDto[]> {
    return this.mapMany(await this.repository.all(filters, args));
  }

  async search(keyword: string, filters?: Filter<T>[]): Promise<TDto[]> {
    return this.mapMany(await this.repository.search(keyword, filters));
  }

  async detail(id: string, args?: BaseRepositoryArgs<T>): Promise<TDto | null> {
    const e = await this.repository.detail(id, args);
    return this.mapDTO(e) ?? null;
  }

  // --- CUD -----------------------------------------------------------------

  async create(entity: DeepPartial<T>, qr?: QueryRunner): Promise<T> {
    return this.repository.create(entity, qr);
  }

  async import(entities: DeepPartial<T>[]): Promise<T[]> {
    return this.repository.import(entities);
  }

  async update(id: string, entity: DeepPartial<T>, qr?: QueryRunner): Promise<T> {
    await this.repository.detail(id);
    return this.repository.update({ ...entity, id } as DeepPartial<T>, qr);
  }

  /** Hard delete — only DTOs marked `deletable: true` are removed; returns the removed DTOs. */
  async delete(id: string): Promise<TDto[]> {
    const dtos = await this.collectDtos(id, (d) => !!d.deletable);
    if (dtos.length) await this.repository.delete(dtos.map((d) => d.id));
    return dtos;
  }

  async softDelete(id: string): Promise<TDto[]> {
    const dtos = await this.collectDtos(id, (d) => !!d.deletable);
    if (dtos.length) await this.repository.softDelete(dtos.map((d) => d.id));
    return dtos;
  }

  async restore(id: string): Promise<TDto[]> {
    const dtos = await this.collectDtos(id, (d) => !!d.restorable);
    if (dtos.length) await this.repository.restore(dtos.map((d) => d.id));
    return dtos;
  }

  // --- SCHEMA INTROSPECTION ------------------------------------------------

  schema(): { schema: SchemaOptions; props: Record<string, SchemaPropOptions>; fields: string[] } {
    const target = this.repository.target as ClassRef;
    const schema = getSchema(target);
    const props = getSchemaProps(target);
    return { schema, props, fields: Object.keys(props) };
  }

  // --- HELPERS -------------------------------------------------------------

  private mapMany(entities: T[]): TDto[] {
    return entities.map((e) => this.mapDTO(e)).filter((d): d is TDto => !!d);
  }

  private async collectDtos(id: string, allow: (dto: TDto) => boolean): Promise<TDto[]> {
    const ids = id
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!ids.length) return [];
    const where: FindOptionsWhere<T> = { id: In(ids) } as never;
    const entities = await this.repository.repository.find({ where, withDeleted: true });
    return entities.map((e) => this.mapDTO(e)).filter((d): d is TDto => !!d && allow(d));
  }
}
