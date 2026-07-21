import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  Brackets,
  type DataSource,
  type DeepPartial,
  type EntityMetadata,
  type EntityTarget,
  type FindOptionsSelect,
  type FindOptionsWhere,
  In,
  type ObjectLiteral,
  type QueryDeepPartialEntity,
  type QueryRunner,
  type Repository,
  type SelectQueryBuilder,
} from 'typeorm';
import type { Filter, Order, PagingReq, PagingRes } from '@sdcorejs/utils/models';
import { ValidationUtilities } from '@sdcorejs/utils/fns';
import type { ContextService } from '../context/context.service';
import type { RequestContext } from '../context/types';
import type { IAuditStrategy } from '../audit/strategy.interface';
import { TENANCY_OPERATIONS, type ITenancyStrategy, type TenancyBypassGrant, type TenancyOperation } from '../tenancy/strategy.interface';
import {
  applyScopeToEntity,
  buildScopeFilters,
  buildScopeWhere,
  getScopedColumnMetadata,
  resolveScopePredicates,
} from '../tenancy/tenancy.helpers';
import type { ScopedColumnMetadata } from './decorators/scoped.decorator';
import {
  InvalidTenancyScopeError,
  MissingTenancyContextError,
  MissingTenancyScopeError,
  TenancyScopeMutationError,
  UnauthorizedTenancyBypassError,
} from '../tenancy/errors';
import { getTenancy } from '../tenancy/tenancy.registry';
import { isAuditEnabled } from './mixins/with-audit';
import type { ClassRef } from './types/class-ref.types';
import { getHistoryRecorder, type HistoryActionType, type IHistoryRecorder, MissingHistoryResourceScopeError } from './history';
import { getSearchableConfig } from './decorators/searchable-fields.decorator';
import { apiError } from './types/api-response.types';
import type { BaseRepositoryArgs } from './types/repository-args.types';
import { applyFilterToQuery, prepareFilter, prepareSorts, resolveColumnName, resolveSortColumn } from './utils/filter-query-builder';

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

/** Thrown before a scoped multi-step mutation when a caller-owned runner has no active transaction. */
export class InactiveMutationTransactionError extends Error {
  constructor() {
    super('A caller-supplied QueryRunner must have an active transaction for scoped mutations');
    this.name = 'InactiveMutationTransactionError';
  }
}

/**
 * Reusable base class for entity repositories. Provides paging / filtering / sorting /
 * search / CUD with parameter sanitization and SQL-injection-safe column resolution.
 *
 * Scoped entities fail closed unless a tenancy strategy supplies every required scope value.
 * Entities without `@Scoped()` columns keep the ordinary TypeORM behaviour.
 */
export abstract class BaseRepository<T extends ObjectLiteral> {
  constructor(
    protected readonly _target: EntityTarget<T>,
    protected readonly datasource: DataSource,
    protected readonly options?: BaseRepositoryOptions,
  ) {}

  // --- Public accessors -----------------------------------------------------

  /**
   * UNSAFE: creates a raw TypeORM query runner whose manager bypasses all tenancy enforcement.
   * Prefer passing an application-owned transaction into the scoped repository methods.
   */
  unsafeCreateQueryRunner(): QueryRunner {
    return this.datasource.createQueryRunner();
  }

  /** UNSAFE: raw TypeORM access bypasses tenancy, mutation guards, and affected-row checks. */
  get unsafeRepository(): Repository<T> {
    return this.rawRepository();
  }

  get target(): EntityTarget<T> {
    return this._target;
  }

  /** UNSAFE: raw TypeORM access bypasses tenancy, mutation guards, and affected-row checks. */
  unsafeGetRepository(qr?: QueryRunner): Repository<T> {
    return this.rawRepository(qr);
  }

  private rawRepository(qr?: QueryRunner): Repository<T> {
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

  private targetName(target: EntityTarget<ObjectLiteral>): string {
    return typeof target === 'function' ? target.name : String(target);
  }

  /** Stable datasource-qualified identifier used by privileged grants and history resource keys. */
  private targetIdentifier(target: EntityTarget<ObjectLiteral>): string {
    try {
      const tablePath = this.datasource.getMetadata(target).tablePath?.trim();
      if (tablePath) return tablePath;
    } catch {
      // A bypass must never fall back to a possibly-colliding constructor name.
    }
    throw new UnauthorizedTenancyBypassError('The tenancy bypass target could not be resolved to EntityMetadata.tablePath');
  }

  private scopedColumns(target: EntityTarget<ObjectLiteral>): readonly ScopedColumnMetadata[] {
    return typeof target === 'function' ? getScopedColumnMetadata(target as ClassRef) : [];
  }

  private assertBypassGrant(grant: unknown, target: EntityTarget<ObjectLiteral>, operation: TenancyOperation): void {
    const partial = grant as Partial<TenancyBypassGrant> | null;
    if (
      typeof grant !== 'object' ||
      grant === null ||
      partial?.authorized !== true ||
      typeof partial.actorId !== 'string' ||
      !partial.actorId.trim() ||
      typeof partial.reason !== 'string' ||
      !partial.reason.trim() ||
      !Array.isArray(partial.allowedTargets) ||
      !partial.allowedTargets.length ||
      partial.allowedTargets.some((item) => typeof item !== 'string' || !item.trim()) ||
      !Array.isArray(partial.allowedOperations) ||
      !partial.allowedOperations.length ||
      partial.allowedOperations.some((item) => !TENANCY_OPERATIONS.includes(item as TenancyOperation)) ||
      typeof partial.audit !== 'function'
    ) {
      throw new UnauthorizedTenancyBypassError();
    }
    const validGrant = grant as TenancyBypassGrant;
    const targetName = this.targetIdentifier(target);
    if (
      (!validGrant.allowedTargets.includes('*') && !validGrant.allowedTargets.includes(targetName)) ||
      !validGrant.allowedOperations.includes(operation)
    ) {
      throw new UnauthorizedTenancyBypassError('The tenancy bypass grant does not authorize this target and operation');
    }
    const auditResult = (validGrant.audit as (event: Parameters<TenancyBypassGrant['audit']>[0]) => unknown)({
      actorId: validGrant.actorId,
      reason: validGrant.reason,
      target: targetName,
      operation,
      occurredAt: new Date(),
    });
    if (auditResult !== undefined) {
      // Query construction is synchronous, so an async/thenable audit cannot be guaranteed to
      // finish before bypass is consumed. Observe rejections and fail closed before issuing SQL.
      if (
        typeof auditResult === 'object' &&
        auditResult !== null &&
        'then' in auditResult &&
        typeof (auditResult as { then?: unknown }).then === 'function'
      ) {
        void Promise.resolve(auditResult).catch(() => undefined);
      }
      throw new UnauthorizedTenancyBypassError('The tenancy bypass audit callback must complete synchronously');
    }
  }

  /** Returns true only for a structured grant whose mandatory audit callback succeeds. */
  private shouldBypass(target: EntityTarget<ObjectLiteral>, operation: TenancyOperation): boolean {
    const columns = this.scopedColumns(target);
    if (!columns.length) return false;
    const strategy = this.tenancyStrategy;
    if (!strategy) throw new MissingTenancyContextError(this.targetName(target));
    const ctx = this.ctx;
    const grant = strategy.getBypassGrant?.(ctx);
    if (grant !== undefined) {
      this.assertBypassGrant(grant, target, operation);
      return true;
    }
    if (strategy.shouldBypass(ctx)) throw new UnauthorizedTenancyBypassError();
    return false;
  }

  private currentScope(target: EntityTarget<ObjectLiteral>, operation: TenancyOperation): Record<string, unknown> | undefined {
    const columns = this.scopedColumns(target);
    if (!columns.length) return undefined;
    const strategy = this.tenancyStrategy;
    if (!strategy) throw new MissingTenancyContextError(this.targetName(target));
    if (this.shouldBypass(target, operation)) return undefined;
    const scope = strategy.getCurrentScope(this.ctx) as unknown;
    if (scope === undefined || scope === null) {
      throw new MissingTenancyScopeError(columns.filter((column) => column.required).map((column) => column.propertyName));
    }
    if (typeof scope !== 'object' || Array.isArray(scope)) {
      throw new InvalidTenancyScopeError('*', 'strategy must return an object keyed by scoped property name');
    }
    return scope as Record<string, unknown>;
  }

  /** Sanitize input filters + inject tenancy scope filters when strategy is active. */
  protected addonFilter(filters: Filter<T>[] | undefined): Filter<T>[] {
    const cleaned = prepareFilter(filters);
    const columns = this.scopedColumns(this._target);
    if (!columns.length) return cleaned;
    const scope = this.currentScope(this._target, 'read');
    if (!scope) return cleaned;
    return [...cleaned, ...buildScopeFilters<T>(scope, columns)];
  }

  /** Build a `findOne` where-fragment that scopes by tenancy, or `{}` when tenancy is inactive. */
  protected scopeWhere(operation: TenancyOperation = 'read'): Record<string, unknown> {
    return this.scopeWhereFor(this._target, operation);
  }

  private scopeWhereFor(target: EntityTarget<ObjectLiteral>, operation: TenancyOperation): Record<string, unknown> {
    const columns = this.scopedColumns(target);
    if (!columns.length) return {};
    const scope = this.currentScope(target, operation);
    return scope ? buildScopeWhere(scope, columns) : {};
  }

  /** Auto-fill tenancy columns from current scope unless strategy says bypass. */
  protected fillTenancy(entity: DeepPartial<T>, operation: 'create' | 'import' = 'create'): void {
    const columns = this.scopedColumns(this._target);
    if (!columns.length) return;
    const scope = this.currentScope(this._target, operation);
    if (!scope) return;
    applyScopeToEntity(entity as Record<string, unknown>, scope, columns);
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

  /** Max rows a single `paging` page may return — hard cap on the public paging path. */
  static readonly MAX_PAGE_SIZE = 200;

  private preparePagingReq(req: PagingReq<T>): Required<PagingReq<T>> {
    return {
      pageNumber: Math.max(req.pageNumber ?? 0, 0),
      // 0-based pages (system default page 0). pageSize is capped at MAX_PAGE_SIZE; a missing or
      // non-positive value falls back to 10 — `paging` never returns the whole table. Unbounded
      // reads go through `all()`, which bypasses this via `createBaseQueryBuilder(.., paginate=false)`.
      pageSize: req.pageSize && req.pageSize > 0 ? Math.min(req.pageSize, BaseRepository.MAX_PAGE_SIZE) : 10,
      orders: prepareSorts(req.orders ?? []) as Order<T>[],
      filters: this.addonFilter(req.filters) as Filter<T>[],
      fields: (req.fields ?? []) as never,
    };
  }

  private relationMetadata(root: EntityMetadata, path: string): EntityMetadata {
    let current = root;
    for (const property of path.split('.')) {
      const relation = current.findRelationWithPropertyPath(property);
      if (!relation) {
        throw new BadRequestException(apiError('core.repository.relation-not-found', 'Relation not found', { relation: path }));
      }
      current = relation.inverseEntityMetadata;
    }
    return current;
  }

  private relationScope(
    metadata: EntityMetadata,
    alias: string,
    parameterPrefix: string,
  ): { condition?: string; parameters?: ObjectLiteral } {
    const target = metadata.target as EntityTarget<ObjectLiteral>;
    const columns = this.scopedColumns(target);
    if (!columns.length) return {};
    const scope = this.currentScope(target, 'read');
    if (!scope) return {};

    const conditions: string[] = [];
    const parameters: ObjectLiteral = {};
    for (const [index, predicate] of resolveScopePredicates(scope, columns).entries()) {
      const column = metadata.findColumnWithPropertyName(predicate.propertyName);
      if (!column) {
        throw new BadRequestException(
          apiError('core.repository.column-not-found', 'Scoped column not found in entity', { field: predicate.propertyName }),
        );
      }
      if (predicate.operator === 'IN' && predicate.values.length === 0) return { condition: '1 = 0' };
      const parameter = `${parameterPrefix}_${index}`;
      const columnSql = `${alias}."${column.databaseName.replace(/"/g, '""')}"`;
      if (predicate.operator === 'IN') {
        conditions.push(`${columnSql} IN (:...${parameter})`);
        parameters[parameter] = [...predicate.values];
      } else {
        conditions.push(`${columnSql} = :${parameter}`);
        parameters[parameter] = predicate.values[0];
      }
    }
    return conditions.length ? { condition: conditions.join(' AND '), parameters } : {};
  }

  private createBaseQueryBuilder(req: Required<PagingReq<T>>, args?: BaseRepositoryArgs<T>, paginate = true): SelectQueryBuilder<T> {
    const { pageNumber, pageSize, orders, filters } = req;
    const alias = 'e';
    const repository = this.rawRepository();
    const meta = repository.metadata;
    const query = repository.createQueryBuilder(alias);

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
      const currentAlias = relation.replace(/\./g, '_');
      const relationMeta = this.relationMetadata(meta, relation);
      const scope = this.relationScope(relationMeta, currentAlias, `relation_scope_${relationSet.size}_${currentAlias}`);
      if (!relation.includes('.')) {
        query.leftJoinAndSelect(`${alias}.${relation}`, currentAlias, scope.condition, scope.parameters);
        continue;
      }
      const lastDot = relation.lastIndexOf('.');
      const prop = relation.substring(lastDot + 1);
      const parentAlias = relation.substring(0, lastDot).replace(/\./g, '_');
      query.leftJoinAndSelect(`${parentAlias}.${prop}`, currentAlias, scope.condition, scope.parameters);
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

    if (paginate && pageSize > 0) query.skip(pageNumber * pageSize).take(pageSize);

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
    // Unbounded fetch — bypass the paging cap (paginate=false → no LIMIT/OFFSET).
    const q = this.createBaseQueryBuilder(this.preparePagingReq({ pageNumber: 0, filters }), args, false);
    return q.getMany();
  };

  search = async (keyword: string, filters?: Filter<T>[]): Promise<T[]> => {
    const term = keyword?.trim();
    const repo = this.rawRepository();
    const meta = repo.metadata;

    // UUID input: exact-match by id, but STILL apply tenancy scope (no cross-tenant id leak).
    if (term && isUuid(term)) {
      const query = repo.createQueryBuilder('e').where('e.id = :id', { id: term });
      const scopeFilters = this.addonFilter([]); // [] of user filters → just the injected tenancy scope
      if (scopeFilters.length) {
        query.andWhere(new Brackets((qb) => scopeFilters.forEach((f, i) => applyFilterToQuery(qb, f, i, 'e', meta))));
      }
      return query.take(1).getMany();
    }

    const config = getSearchableConfig(this._target as never);
    if (!config) return [];

    const finalFilters = this.addonFilter(filters) ?? [];
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
            if (hasCol(f)) qb.orWhere(`${resolveColumnName(f, 'e', meta)} = :term`, { term });
          }
          for (const f of config.contain ?? []) {
            if (!hasCol(f)) continue;
            const searchColumn = resolveColumnName(f, 'e', meta);
            if (activeCol) {
              const activeColumn = resolveColumnName(activeCol, 'e', meta);
              qb.orWhere(
                new Brackets((sub) => {
                  sub
                    .where(`LOWER(UNACCENT(${searchColumn}::text)) LIKE LOWER(UNACCENT(:likeTerm))`, { likeTerm: `%${term}%` })
                    .andWhere(`${activeColumn} = :isActive`, { isActive: true });
                }),
              );
            } else {
              qb.orWhere(`LOWER(UNACCENT(${searchColumn}::text)) LIKE LOWER(UNACCENT(:likeTerm))`, { likeTerm: `%${term}%` });
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
    const req = this.preparePagingReq({
      pageNumber: 0,
      pageSize: 1,
      filters: [{ field: 'id', operator: 'EQUAL', data: id } as Filter<T>],
    });
    return this.createBaseQueryBuilder(req, args).getOne();
  };

  /** Scoped batch lookup used by services before applying DTO-level mutation policy. */
  findByIds = async (ids: string[], args?: BaseRepositoryArgs<T>): Promise<T[]> => {
    const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
    if (!uniqueIds.length) return [];
    return this.all([{ field: 'id', operator: 'IN', data: uniqueIds } as Filter<T>], args);
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
    resourceScope?: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    const recorder = this.historyRecorder;
    if (!recorder || !tableId) return;
    if (this.scopedColumns(this._target).length && !resourceScope) throw new MissingHistoryResourceScopeError();
    await recorder.record({
      table: this.rawRepository(qr).metadata.tablePath,
      tableId,
      type,
      fromData,
      toData,
      ...(resourceScope ? { resourceScope } : {}),
      queryRunner: qr,
    });
  }

  /** Explicitly selects even `select:false` scope columns from already-authorized persisted rows. */
  private async historyResourceScopes(
    repo: Repository<T>,
    where: FindOptionsWhere<T>,
  ): Promise<Map<string, Readonly<Record<string, unknown>>>> {
    const columns = this.scopedColumns(this._target);
    if (!columns.length) return new Map();
    const select = { id: true } as unknown as FindOptionsSelect<T>;
    for (const column of columns) (select as Record<string, boolean>)[column.propertyName] = true;
    const rows = await repo.find({ where, withDeleted: true, select });
    const scopes = new Map<string, Readonly<Record<string, unknown>>>();
    for (const row of rows) {
      const record = row as Record<string, unknown>;
      const id = record.id;
      if (typeof id !== 'string' || !id) throw new MissingHistoryResourceScopeError();
      const scope: Record<string, unknown> = {};
      for (const column of columns) {
        if (!Object.prototype.hasOwnProperty.call(record, column.propertyName) || record[column.propertyName] === undefined) {
          throw new MissingHistoryResourceScopeError();
        }
        scope[column.propertyName] = record[column.propertyName];
      }
      scopes.set(id, Object.freeze(scope));
    }
    return scopes;
  }

  private mutationNotFound(): NotFoundException {
    return new NotFoundException(apiError('core.repository.not-found', 'Resource not found'));
  }

  private mutationWhere(ids: string[], operation: TenancyOperation): FindOptionsWhere<T> {
    const id = ids.length === 1 ? ids[0] : In(ids);
    return { id, ...this.scopeWhere(operation) } as unknown as FindOptionsWhere<T>;
  }

  private assertAffected(affected: number | null | undefined, expected: number): void {
    if (affected !== expected) throw this.mutationNotFound();
  }

  /** Owns a transaction unless the caller already supplied one. Failed count checks roll back. */
  private async withMutationRunner<R>(provided: QueryRunner | undefined, work: (runner: QueryRunner) => Promise<R>): Promise<R> {
    if (provided) {
      if (!provided.isTransactionActive) throw new InactiveMutationTransactionError();
      return work(provided);
    }
    const runner = this.datasource.createQueryRunner();
    try {
      await runner.connect();
      await runner.startTransaction();
      const result = await work(runner);
      await runner.commitTransaction();
      return result;
    } catch (error) {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      throw error;
    } finally {
      if (!runner.isReleased) await runner.release();
    }
  }

  create = async (entity: DeepPartial<T>, qr?: QueryRunner): Promise<T> => {
    this.fillAuditOnCreate(entity);
    // Apply caller-independent scope last so no audit hook can accidentally overwrite it.
    this.fillTenancy(entity);
    return this.withMutationRunner(qr, async (runner) => {
      const repo = this.rawRepository(runner);
      const e = repo.create(entity);
      const saved = await repo.save(e);
      const id = (saved as { id?: string }).id ?? '';
      const scopes = this.historyRecorder
        ? await this.historyResourceScopes(repo, { id } as unknown as FindOptionsWhere<T>)
        : new Map<string, Readonly<Record<string, unknown>>>();
      await this.recordHistory('CREATE', id, null, saved, runner, scopes.get(id));
      return saved;
    });
  };

  update = async (entity: DeepPartial<T>, qr?: QueryRunner): Promise<T> => {
    const id = (entity as { id?: string }).id;
    if (!id) throw new BadRequestException(apiError('core.repository.invalid-uuid', 'An id is required for update'));
    const patch = { ...(entity as Record<string, unknown>) };
    delete patch.id;
    this.fillAuditOnUpdate(patch as DeepPartial<T>);
    // Validate after the audit hook: neither caller input nor an audit strategy may move scope.
    for (const column of this.scopedColumns(this._target)) {
      if (Object.prototype.hasOwnProperty.call(patch, column.propertyName)) {
        throw new TenancyScopeMutationError(column.propertyName);
      }
    }

    return this.withMutationRunner(qr, async (runner) => {
      const repo = this.rawRepository(runner);
      const where = this.mutationWhere([id], 'update');
      const oldData = this.historyRecorder ? await repo.findOne({ where, withDeleted: true }) : null;
      const scopes = this.historyRecorder
        ? await this.historyResourceScopes(repo, where)
        : new Map<string, Readonly<Record<string, unknown>>>();
      if (Object.keys(patch).length) {
        const result = await repo.update(where, patch as QueryDeepPartialEntity<T>);
        this.assertAffected(result.affected, 1);
      }
      const saved = await repo.findOne({ where, withDeleted: true });
      if (!saved) throw this.mutationNotFound();
      await this.recordHistory('UPDATE', id, oldData, saved, runner, scopes.get(id));
      return saved;
    });
  };

  delete = async (id: string | string[], qr?: QueryRunner): Promise<boolean> => {
    const ids = this.parseIds(id);
    if (!ids.length) return false;
    return this.withMutationRunner(qr, async (runner) => {
      const repo = this.rawRepository(runner);
      const where = this.mutationWhere(ids, 'delete');
      const olds = this.historyRecorder ? await repo.find({ where, withDeleted: true }) : [];
      const scopes = this.historyRecorder
        ? await this.historyResourceScopes(repo, where)
        : new Map<string, Readonly<Record<string, unknown>>>();
      const matched = this.historyRecorder ? olds.length : await repo.count({ where, withDeleted: true });
      this.assertAffected(matched, ids.length);
      const result = await repo.delete(where);
      this.assertAffected(result.affected, ids.length);
      for (const old of olds) {
        const id = (old as { id?: string }).id ?? '';
        await this.recordHistory('DELETE', id, old, null, runner, scopes.get(id));
      }
      return true;
    });
  };

  softDelete = async (id: string | string[], qr?: QueryRunner): Promise<boolean> => {
    const ids = this.parseIds(id);
    if (!ids.length) return false;
    return this.withMutationRunner(qr, async (runner) => {
      const repo = this.rawRepository(runner);
      const where = this.mutationWhere(ids, 'soft-delete');
      this.assertAffected(await repo.count({ where, withDeleted: true }), ids.length);
      const result = await repo.softDelete(where);
      this.assertAffected(result.affected, ids.length);
      return true;
    });
  };

  restore = async (id: string | string[], qr?: QueryRunner): Promise<boolean> => {
    const ids = this.parseIds(id);
    if (!ids.length) return false;
    return this.withMutationRunner(qr, async (runner) => {
      const repo = this.rawRepository(runner);
      const where = this.mutationWhere(ids, 'restore');
      this.assertAffected(await repo.count({ where, withDeleted: true }), ids.length);
      const result = await repo.restore(where);
      this.assertAffected(result.affected, ids.length);
      return true;
    });
  };

  import = async (entities: DeepPartial<T>[], qr?: QueryRunner): Promise<T[]> => {
    if (!entities?.length) return [];
    for (const e of entities) {
      this.fillAuditOnCreate(e);
      this.fillTenancy(e, 'import');
    }

    return this.withMutationRunner(qr, async (runner) => {
      const chunkSize = 1000;
      const out: T[] = [];
      const repo = this.rawRepository(runner);

      for (let i = 0; i < entities.length; i += chunkSize) {
        const chunk = entities.slice(i, i + chunkSize);
        const result = await repo
          .createQueryBuilder()
          .insert()
          .into(this._target)
          .values(chunk as never)
          .updateEntity(false)
          .returning('*')
          .execute();
        if (result.raw) out.push(...(result.raw as T[]));
      }
      return out;
    });
  };

  private parseIds(id: string | string[]): string[] {
    const ids = Array.isArray(id)
      ? id.filter(Boolean)
      : id
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
    return Array.from(new Set(ids));
  }
}
