import { Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ValidationUtilities } from '@sdcorejs/utils/fns';
import type { QueryRunner, Repository } from 'typeorm';
import { ContextService } from '../../core/context/context.service';
import type { RequestContext } from '../../core/context/types';
import { apiError } from '../../core/orm/types/api-response.types';
import type { HistoryEntry, IHistoryRecorder } from '../../core/orm/history';
import { ActionHistory } from './action-history.entity';
import {
  ACTION_HISTORY_ACTOR_RESOLVER,
  ACTION_HISTORY_SECURITY_OPTIONS,
  type ActionHistoryActorResolver,
  type ActionHistoryDTO,
  type ActionHistoryPage,
  type ActionHistoryQuery,
  type ActionHistorySaveReq,
  type ActionHistorySecurityOptions,
  ActionHistoryType,
} from './types';

const DEFAULT_MAX_PAGE_SIZE = 100;
const ABSOLUTE_MAX_PAGE_SIZE = 200;
const ABSOLUTE_MAX_OFFSET = 100_000;
const MAX_RESOURCE_TABLE_PATH_LENGTH = 256;
const MAX_SNAPSHOT_DEPTH = 32;
const MAX_SNAPSHOT_NODES = 10_000;
const MAX_SNAPSHOT_UTF8_BYTES = 1024 * 1024;
const REDACTED = '[REDACTED]';
const UNSAFE_SNAPSHOT_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const { isUuid } = ValidationUtilities;
const DEFAULT_SENSITIVE_FIELDS = new Set([
  'password',
  'passwd',
  'secret',
  'clientsecret',
  'token',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'authorization',
  'apikey',
  'accesskey',
  'privatekey',
  'credential',
]);
const SENSITIVE_FIELD_MARKERS = [
  'password',
  'passwd',
  'secret',
  'token',
  'privatekey',
  'apikey',
  'accesskey',
  'credential',
  'authorization',
] as const;

/** Thrown on write paths when an audit row cannot be assigned to a trusted tenant. */
export class MissingActionHistoryTenantError extends Error {
  constructor() {
    super('A trusted tenant context is required to write action history');
    this.name = 'MissingActionHistoryTenantError';
  }
}

/** Thrown when persisted resource scope cannot be mapped to one trustworthy history tenant. */
export class MissingActionHistoryResourceTenantError extends Error {
  constructor() {
    super('Persisted resource scope could not be resolved to an action-history tenant');
    this.name = 'MissingActionHistoryResourceTenantError';
  }
}

/** Thrown before persistence when an audit snapshot exceeds the fixed defensive traversal budget. */
export class ActionHistorySnapshotLimitError extends Error {
  constructor() {
    super('Action-history snapshot exceeds the safe depth, node, or UTF-8 byte limit');
    this.name = 'ActionHistorySnapshotLimitError';
  }
}

/** Thrown before persistence when a snapshot contains accessors or prototype-sensitive keys. */
export class ActionHistoryUnsafeSnapshotError extends Error {
  constructor() {
    super('Action-history snapshot contains an unsafe property');
    this.name = 'ActionHistoryUnsafeSnapshotError';
  }
}

const normalizeField = (field: string): string => field.toLowerCase().replace(/[^a-z0-9]/g, '');
const isSensitiveField = (field: string): boolean => {
  const normalized = normalizeField(field);
  return DEFAULT_SENSITIVE_FIELDS.has(normalized) || SENSITIVE_FIELD_MARKERS.some((marker) => normalized.includes(marker));
};

/**
 * Records and queries tenant-scoped action-history rows. Reads are denied unless the configured
 * resource authorization policy explicitly allows the current trusted context.
 */
@Injectable()
export class ActionHistoryService implements IHistoryRecorder {
  constructor(
    @InjectRepository(ActionHistory) private readonly repository: Repository<ActionHistory>,
    @Optional() @Inject(ContextService) private readonly context?: ContextService,
    @Optional() @Inject(ACTION_HISTORY_ACTOR_RESOLVER) private readonly resolveActor?: ActionHistoryActorResolver,
    @Optional()
    @Inject(ACTION_HISTORY_SECURITY_OPTIONS)
    private readonly security: ActionHistorySecurityOptions = {},
  ) {}

  async create<T = unknown>(req: ActionHistorySaveReq<T>, queryRunner?: QueryRunner): Promise<void> {
    await this.persist(req, this.requireTenant(), queryRunner);
  }

  private async persist<T = unknown>(req: ActionHistorySaveReq<T>, tenantCode: string, queryRunner?: QueryRunner): Promise<void> {
    const requestContext = this.context?.store ?? {};
    const actor = this.context ? (this.resolveActor?.(this.context) ?? { userId: this.context.userId }) : {};
    const entity = this.repository.create({
      ...req,
      tenantCode,
      fromData: this.sanitizeSnapshot(req.fromData, requestContext),
      toData: this.sanitizeSnapshot(req.toData, requestContext),
      userId: actor.userId,
      username: actor.username,
      fullName: actor.fullName,
    } as ActionHistory);
    if (queryRunner) {
      await queryRunner.manager.getRepository(ActionHistory).save(entity);
    } else {
      await this.repository.save(entity);
    }
  }

  /** {@link IHistoryRecorder} entry point called by scoped repository mutations. */
  async record(entry: HistoryEntry): Promise<void> {
    const tenantCode = this.resolveHistoryTenant(entry);
    await this.persist(
      {
        table: entry.table,
        tableId: entry.tableId,
        type: entry.type as ActionHistoryType,
        fromData: entry.fromData,
        toData: entry.toData,
      },
      tenantCode,
      entry.queryRunner,
    );
  }

  /**
   * Return one authorized resource's history. Tenant, resource type and resource id are all part of
   * the database predicate; missing and unauthorized resources share the same 404 response.
   */
  async all<T = unknown>(query: ActionHistoryQuery): Promise<ActionHistoryPage<T>> {
    if (!query || typeof query !== 'object') this.notFound();
    const table = query.table?.trim();
    const tableId = query.tableId?.trim();
    if (!table || table.length > MAX_RESOURCE_TABLE_PATH_LENGTH || !tableId || !isUuid(tableId)) this.notFound();
    const tenantCode = this.currentTenant();
    if (!tenantCode) this.notFound();

    const context = this.context?.store ?? {};
    const authorized = await this.security.authorizeRead?.({
      context,
      tenantCode,
      table,
      tableId,
    });
    if (authorized !== true) this.notFound();

    const requestedMax = Number.isFinite(this.security.maxPageSize) ? Math.trunc(this.security.maxPageSize!) : DEFAULT_MAX_PAGE_SIZE;
    const configuredMax = Math.min(Math.max(1, requestedMax), ABSOLUTE_MAX_PAGE_SIZE);
    const pageSize = Number.isFinite(query.pageSize) ? Math.min(Math.max(1, Math.trunc(query.pageSize!)), configuredMax) : configuredMax;
    const requestedPage = Number.isFinite(query.pageNumber) ? Math.max(0, Math.trunc(query.pageNumber!)) : 0;
    const pageNumber = Math.min(requestedPage, Math.floor(ABSOLUTE_MAX_OFFSET / pageSize));
    const [entities, total] = await this.repository.findAndCount({
      where: { tenantCode, table, tableId },
      order: { createdAt: 'DESC' },
      skip: pageNumber * pageSize,
      take: pageSize,
    });
    return { items: entities.map((entity) => this.mapDTO<T>(entity)), total };
  }

  private currentTenant(): string | undefined {
    const value = this.context?.tenant ?? this.context?.getCustom<string>('tenantCode');
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }

  private requireTenant(): string {
    const tenantCode = this.currentTenant();
    if (!tenantCode) throw new MissingActionHistoryTenantError();
    return tenantCode;
  }

  private resolveHistoryTenant(entry: HistoryEntry): string {
    const scope = entry.resourceScope;
    if (!scope || !Object.keys(scope).length) return this.requireTenant();
    const defaultTenant = this.normalizeTenant(scope.tenantCode);
    const resolved = this.normalizeTenant(
      this.security.resolveResourceTenant?.({
        context: this.context?.store ?? {},
        table: entry.table,
        tableId: entry.tableId,
        resourceScope: scope,
        fromData: entry.fromData,
        toData: entry.toData,
      }) ?? defaultTenant,
    );
    if (defaultTenant && resolved && defaultTenant !== resolved) throw new MissingActionHistoryResourceTenantError();
    if (!resolved) throw new MissingActionHistoryResourceTenantError();
    return resolved;
  }

  private normalizeTenant(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }

  private notFound(): never {
    throw new NotFoundException(apiError('core.history.not-found', 'History not found'));
  }

  private sanitizeSnapshot(value: unknown, context: RequestContext): unknown {
    if (value === undefined) return undefined;
    const candidate = this.security.redactSnapshot ? this.security.redactSnapshot(value, context) : value;
    const configured = new Set((this.security.redactFields ?? []).map((field) => field.toLowerCase()));
    const seen = new WeakSet<object>();
    let nodes = 0;
    let utf8Bytes = 0;
    const consume = (value: unknown, path: string, depth: number): void => {
      nodes += 1;
      if (typeof value === 'string') utf8Bytes += Buffer.byteLength(value, 'utf8');
      utf8Bytes += Buffer.byteLength(path, 'utf8');
      if (depth > MAX_SNAPSHOT_DEPTH || nodes > MAX_SNAPSHOT_NODES || utf8Bytes > MAX_SNAPSHOT_UTF8_BYTES) {
        throw new ActionHistorySnapshotLimitError();
      }
    };
    const walk = (current: unknown, path: string, depth: number): unknown => {
      consume(current, path, depth);
      if (current === null || typeof current !== 'object') return current;
      if (current instanceof Date) return Date.prototype.toISOString.call(current);
      if (seen.has(current)) return REDACTED;
      seen.add(current);
      if (Array.isArray(current)) {
        const output = new Array<unknown>(current.length);
        for (let index = 0; index < current.length; index += 1) {
          const descriptor = Object.getOwnPropertyDescriptor(current, String(index));
          if (!descriptor) continue;
          if (!('value' in descriptor)) throw new ActionHistoryUnsafeSnapshotError();
          output[index] = walk(descriptor.value, path ? `${path}.${index}` : String(index), depth + 1);
        }
        for (const key of Reflect.ownKeys(current)) {
          if (key === 'length') continue;
          if (typeof key === 'string') {
            const index = Number(key);
            if (Number.isSafeInteger(index) && index >= 0 && index < current.length && String(index) === key) continue;
          }
          const descriptor = Object.getOwnPropertyDescriptor(current, key);
          if (descriptor?.enumerable) throw new ActionHistoryUnsafeSnapshotError();
        }
        return output;
      }

      const output = Object.create(null) as Record<string, unknown>;
      for (const key of Reflect.ownKeys(current)) {
        const descriptor = Object.getOwnPropertyDescriptor(current, key);
        if (!descriptor?.enumerable) continue;
        if (typeof key !== 'string' || UNSAFE_SNAPSHOT_KEYS.has(key) || !('value' in descriptor)) {
          throw new ActionHistoryUnsafeSnapshotError();
        }
        const child = descriptor.value;
        const childPath = path ? `${path}.${key}` : key;
        let sanitized: unknown;
        if (isSensitiveField(key) || configured.has(key.toLowerCase()) || configured.has(childPath.toLowerCase())) {
          // Count the redacted node and key path without reading/counting the secret value itself.
          consume(undefined, childPath, depth + 1);
          sanitized = REDACTED;
        } else {
          sanitized = walk(child, childPath, depth + 1);
        }
        Object.defineProperty(output, key, { value: sanitized, enumerable: true, configurable: true, writable: true });
      }
      return output;
    };

    return walk(candidate, '', 0);
  }

  private mapDTO<T>(entity: ActionHistory): ActionHistoryDTO<T> {
    const { id, tenantCode, table, tableId, userId, username, fullName, type, fromData, toData, note, createdAt } = entity;
    return {
      id,
      tenantCode,
      table,
      tableId,
      userId,
      username,
      fullName,
      type,
      fromData: fromData as T,
      toData: toData as T,
      note,
      createdAt: createdAt instanceof Date ? createdAt.toISOString() : createdAt,
    };
  }
}
