import { BadRequestException } from '@nestjs/common';
import {
  Brackets,
  type DataSource,
  type DeepPartial,
  type EntityTarget,
  In,
  type ObjectLiteral,
  type QueryRunner,
  type Repository,
  type SelectQueryBuilder,
} from 'typeorm';
import type { Filter, Order, PagingReq, PagingRes } from '@sdcorejs/utils/models';
import { ValidationUtilities } from '@sdcorejs/utils/fns';
import type { ContextService } from '../context/context.service';
import type { RequestContext } from '../context/types';
import type { IAuditStrategy } from '../audit/strategy.interface';
import type { ITenancyStrategy } from '../tenancy/strategy.interface';
import { applyScopeToEntity, buildScopeFilters, buildScopeWhere, getScopedColumns } from '../tenancy/tenancy.helpers';
import { getTenancy } from '../tenancy/tenancy.registry';
import { isAuditEnabled } from './mixins/with-audit';
import type { ClassRef } from './types/class-ref.types';
import { getHistoryRecorder, type HistoryActionType, type IHistoryRecorder } from './history';
import { getSearchableConfig } from './decorators/searchable-fields.decorator';
import { apiError } from './types/api-response.types';
import type { BaseRepositoryArgs } from './types/repository-args.types';
import { applyFilterToQuery, prepareFilter, prepareSorts, resolveSortColumn } from './utils/filter-query-builder';

const { isUuid } = ValidationUtilities;

export interface BaseRepositoryOptions {
  /** When true, create/update/delete emit a {@link HistoryEntry} to the history recorder. */
  logHistory?: boolean;
  tenancyStrategy?: ITenancyStrategy;
  auditStrategy?: IAuditStrategy;
  contextService?: ContextService;
  /** Recorder to use when `logHistory` is set. Defaults to the globally-registered recorder. */
  historyRecorder?: IHistoryRecorder;
}

/**
 * Reusable base class for entity repositories. Provides paging / filtering / sorting /
 * search / CUD with parameter sanitization and SQL-injection-safe column resolution.
 *
 * Tenancy + audit integration is added in later phases — see `#addonFilter` and `#auditHook`
 * placeholders. With no strategy registered, `BaseRepository` behaves as if those concerns
 * are disabled (zero overhead, zero magic).
 */
export abstract class BaseRepository<T extends ObjectLiteral> {
  constructor(
    protected readonly _target: EntityTarget<T>,
    protected readonly datasource: DataSource,
    protected readonly options?: BaseRepositoryOptions,
  ) {}

  // --- Public accessors -----------------------------------------------------

  get queryRunner(): QueryRunner {
    return this.datasource.createQueryRunner();
  }

  get repository(): Repository<T> {
    return this.datasource.getRepository(this._target);
  }

  get target(): EntityTarget<T> {
    return this._target;
  }

  getRepository(qr?: QueryRunner): Repository<T> {
    return qr ? qr.manager.getRepository(this._target) : this.datasource.getRepository(this._target);
  }

  // --- Tenancy + audit integration hooks -----------------------------------

  /** Effective tenancy strategy: per-repo option overrides the global registry. */
  private get tenancyStrategy(): ITenancyStrategy | undefined {
    return this.options?.tenancyStrategy ?? getTenancy()?.strategy;
  }

  protected get ctx(): RequestContext {
    const contextService = this.options?.contextService ?? getTenancy()?.contextService;
    return contextService?.store ?? {};
  }

  /** Sanitize input filters + inject tenancy scope filters when strategy is active. */
  protected addonFilter(filters: Filter<T>[] | undefined): Filter<T>[] {
    const cleaned = prepareFilter(filters);
    const ts = this.tenancyStrategy;
    if (!ts) return cleaned;
    const ctx = this.ctx;
    if (ts.shouldBypass(ctx)) return cleaned;
    const cols = getScopedColumns(this._target as ClassRef);
    if (!cols.length) return cleaned;
    const scope = ts.getCurrentScope(ctx);
    return [...cleaned, ...buildScopeFilters<T>(scope, cols)];
  }

  /** Build a `findOne` where-fragment that scopes by tenancy, or `{}` when tenancy is inactive. */
  protected scopeWhere(): Record<string, unknown> {
    const ts = this.tenancyStrategy;
    if (!ts) return {};
    const ctx = this.ctx;
    if (ts.shouldBypass(ctx)) return {};
    const cols = getScopedColumns(this._target as ClassRef);
    if (!cols.length) return {};
    return buildScopeWhere(ts.getCurrentScope(ctx), cols);
  }

  /** Auto-fill tenancy columns from current scope unless strategy says bypass. */
  protected fillTenancy(entity: DeepPartial<T>): void {
    const ts = this.tenancyStrategy;
    if (!ts) return;
    const ctx = this.ctx;
    if (ts.shouldBypass(ctx)) return;
    const cols = getScopedColumns(this._target as ClassRef);
    if (!cols.length) return;
    const scope = ts.getCurrentScope(ctx);
    applyScopeToEntity(entity as Record<string, unknown>, scope, cols);
  }

  /** Fire `IAuditStrategy.onCreate` for `WithAudit` entities when strategy is active. */
  protected fillAuditOnCreate(entity: DeepPartial<T>): void {
    const as = this.options?.auditStrategy;
    if (!as) return;
    if (!isAuditEnabled(this._target as ClassRef)) return;
    as.onCreate(entity, this.ctx);
  }

  /** Fire `IAuditStrategy.onUpdate` for `WithAudit` entities when strategy is active. */
  protected fillAuditOnUpdate(entity: DeepPartial<T>): void {
    const as = this.options?.auditStrategy;
    if (!as) return;
    if (!isAuditEnabled(this._target as ClassRef)) return;
    as.onUpdate(entity, this.ctx);
  }

  // --- Internal helpers -----------------------------------------------------

  private preparePagingReq(req: PagingReq<T>): Required<PagingReq<T>> {
    return {
      pageNumber: Math.max(req.pageNumber ?? 0, 0),
      pageSize: Math.min(req.pageSize ?? 10, 1000),
      orders: prepareSorts(req.orders ?? []) as Order<T>[],
      filters: this.addonFilter(req.filters) as Filter<T>[],
      fields: (req.fields ?? []) as never,
    };
  }

  private createBaseQueryBuilder(req: Required<PagingReq<T>>, args?: BaseRepositoryArgs<T>): SelectQueryBuilder<T> {
    const { pageNumber, pageSize, orders, filters } = req;
    const alias = 'e';
    const meta = this.repository.metadata;
    const query = this.repository.createQueryBuilder(alias);

    if (args?.withDeleted) query.withDeleted();

    // Pre-process relations: auto-add parents (input 'a.b' → join 'a' then 'a.b')
    const relationSet = new Set<string>();
    for (const r of args?.relations ?? []) {
      let path = '';
      for (const part of r.split('.')) {
        path = path ? `${path}.${part}` : part;
        relationSet.add(path);
      }
    }
    for (const relation of [...relationSet].sort()) {
      if (!relation.includes('.')) {
        query.leftJoinAndSelect(`${alias}.${relation}`, relation);
        continue;
      }
      const lastDot = relation.lastIndexOf('.');
      const prop = relation.substring(lastDot + 1);
      const parentAlias = relation.substring(0, lastDot).replace(/\./g, '_');
      const currentAlias = relation.replace(/\./g, '_');
      query.leftJoinAndSelect(`${parentAlias}.${prop}`, currentAlias);
    }

    for (const item of args?.andWheres ?? []) {
      if (item.where) query.andWhere(item.where, item.parameters);
    }

    if (filters?.length) {
      query.andWhere(
        new Brackets((qb) => {
          filters.forEach((f, i) => applyFilterToQuery(qb, f, i, alias, meta));
        }),
      );
    }

    if (orders?.length) {
      orders.forEach((o, i) => {
        const col = resolveSortColumn(o.field as string, alias, meta);
        if (i === 0) {
          query.orderBy(col, o.direction, o.direction === 'ASC' ? 'NULLS FIRST' : 'NULLS LAST');
        } else {
          query.addOrderBy(col, o.direction, o.direction === 'ASC' ? 'NULLS FIRST' : 'NULLS LAST');
        }
      });
    }

    if (pageSize > 0) query.skip(pageNumber * pageSize).take(pageSize);

    return query;
  }

  // --- READ -----------------------------------------------------------------

  paging = async (req: PagingReq<T>, args?: BaseRepositoryArgs<T>): Promise<PagingRes<T>> => {
    const q = this.createBaseQueryBuilder(this.preparePagingReq(req), args);
    const [items, total] = await q.getManyAndCount();
    return { items, total };
  };

  pagingDeleted = async (req: PagingReq<T>, args?: BaseRepositoryArgs<T>): Promise<PagingRes<T>> => {
    return this.paging(req, { ...args, withDeleted: true });
  };

  all = async (filters?: Filter<T>[], args?: BaseRepositoryArgs<T>): Promise<T[]> => {
    const req: PagingReq<T> = { pageNumber: 0, pageSize: 0, filters };
    const q = this.createBaseQueryBuilder(this.preparePagingReq(req), args);
    return q.getMany();
  };

  search = async (keyword: string, filters?: Filter<T>[]): Promise<T[]> => {
    const term = keyword?.trim();
    const repo = this.repository;

    // UUID input: exact-match by id, bypass filters + tenancy.
    if (term && isUuid(term)) {
      return repo.createQueryBuilder('e').where('e.id = :id', { id: term }).take(1).getMany();
    }

    const config = getSearchableConfig(this._target as never);
    if (!config) return [];

    const finalFilters = this.addonFilter(filters) ?? [];
    const meta = repo.metadata;
    const query = repo.createQueryBuilder('e');

    if (finalFilters.length) {
      query.andWhere(
        new Brackets((qb) => {
          finalFilters.forEach((f, i) => applyFilterToQuery(qb, f, i, 'e', meta));
        }),
      );
    }

    if (term) {
      const hasCol = (p: string) => !!meta.findColumnWithPropertyName(p);
      const activeCol = config.activeColumn && hasCol(config.activeColumn) ? config.activeColumn : undefined;

      query.andWhere(
        new Brackets((qb) => {
          for (const f of config.exact ?? []) {
            if (hasCol(f)) qb.orWhere(`e."${f}" = :term`, { term });
          }
          for (const f of config.contain ?? []) {
            if (!hasCol(f)) continue;
            if (activeCol) {
              qb.orWhere(
                new Brackets((sub) => {
                  sub
                    .where(`LOWER(UNACCENT(e."${f}"::text)) LIKE LOWER(UNACCENT(:likeTerm))`, { likeTerm: `%${term}%` })
                    .andWhere(`e."${activeCol}" = :isActive`, { isActive: true });
                }),
              );
            } else {
              qb.orWhere(`LOWER(UNACCENT(e."${f}"::text)) LIKE LOWER(UNACCENT(:likeTerm))`, { likeTerm: `%${term}%` });
            }
          }
        }),
      );
    }

    return query.take(20).getMany();
  };

  detail = async (id: string, args?: BaseRepositoryArgs<T>): Promise<T | null> => {
    if (!isUuid(id)) {
      throw new BadRequestException(apiError('core.repository.invalid-uuid', 'Invalid UUID', { id }));
    }
    const uniqueRelations = Array.from(new Set(args?.relations ?? []));
    return this.repository.findOne({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      where: { id, ...this.scopeWhere() } as any,
      relations: uniqueRelations,
      withDeleted: args?.withDeleted ?? true,
    });
  };

  // --- CUD ------------------------------------------------------------------

  /** Resolve the effective history recorder (explicit option wins over the global one). */
  private get historyRecorder(): IHistoryRecorder | undefined {
    if (!this.options?.logHistory) return undefined;
    return this.options.historyRecorder ?? getHistoryRecorder();
  }

  /** Emit one history entry when `logHistory` is enabled and a recorder is available. */
  private async recordHistory(
    type: HistoryActionType,
    tableId: string,
    fromData: unknown,
    toData: unknown,
    qr?: QueryRunner,
  ): Promise<void> {
    const recorder = this.historyRecorder;
    if (!recorder || !tableId) return;
    await recorder.record({
      table: this.getRepository(qr).metadata.tableName,
      tableId,
      type,
      fromData,
      toData,
      queryRunner: qr,
    });
  }

  create = async (entity: DeepPartial<T>, qr?: QueryRunner): Promise<T> => {
    const repo = this.getRepository(qr);
    this.fillTenancy(entity);
    this.fillAuditOnCreate(entity);
    const e = repo.create(entity);
    const saved = await repo.save(e);
    await this.recordHistory('CREATE', (saved as { id?: string }).id ?? '', null, saved, qr);
    return saved;
  };

  update = async (entity: DeepPartial<T>, qr?: QueryRunner): Promise<T> => {
    const repo = this.getRepository(qr);
    this.fillAuditOnUpdate(entity);
    const id = (entity as { id?: string }).id;
    let oldData: T | null = null;
    if (this.historyRecorder && id) {
      oldData = await repo.findOne({ where: { id } as never, withDeleted: true });
    }
    const e = repo.create(entity);
    const saved = await repo.save(e);
    const toData = oldData ? { ...oldData, ...saved } : saved;
    await this.recordHistory('UPDATE', (saved as { id?: string }).id ?? '', oldData, toData, qr);
    return saved;
  };

  delete = async (id: string | string[], qr?: QueryRunner): Promise<boolean> => {
    const ids = this.parseIds(id);
    if (!ids.length) return false;
    const olds = this.historyRecorder
      ? await this.repository.find({ where: { id: In(ids) } as never, withDeleted: true })
      : [];
    const result = qr ? await qr.manager.delete(this._target, ids) : await this.repository.delete(ids);
    if (result.affected) {
      for (const old of olds) {
        await this.recordHistory('DELETE', (old as { id?: string }).id ?? '', old, null, qr);
      }
    }
    return !!result.affected;
  };

  softDelete = async (id: string | string[], qr?: QueryRunner): Promise<boolean> => {
    const ids = this.parseIds(id);
    if (!ids.length) return false;
    const result = qr ? await qr.manager.softDelete(this._target, ids) : await this.repository.softDelete(ids);
    return !!result.affected;
  };

  restore = async (id: string | string[], qr?: QueryRunner): Promise<boolean> => {
    const ids = this.parseIds(id);
    if (!ids.length) return false;
    const result = qr ? await qr.manager.restore(this._target, ids) : await this.repository.restore(ids);
    return !!result.affected;
  };

  import = async (entities: DeepPartial<T>[], qr?: QueryRunner): Promise<T[]> => {
    if (!entities?.length) return [];
    for (const e of entities) {
      this.fillTenancy(e);
      this.fillAuditOnCreate(e);
    }

    const chunkSize = 1000;
    const out: T[] = [];

    for (let i = 0; i < entities.length; i += chunkSize) {
      const chunk = entities.slice(i, i + chunkSize);
      const qb = qr ? qr.manager.createQueryBuilder() : this.repository.createQueryBuilder();
      const result = await qb
        .insert()
        .into(this._target)
        .values(chunk as never)
        .updateEntity(false)
        .returning('*')
        .execute();
      if (result.raw) out.push(...(result.raw as T[]));
    }
    return out;
  };

  private parseIds(id: string | string[]): string[] {
    if (Array.isArray(id)) return id.filter(Boolean);
    return id
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
}
