import type { ContextService } from '../../core/context/context.service';
import type { RequestContext } from '../../core/context/types';
import type { HistoryEntry } from '../../core/orm/history';

/** Kind of change recorded in an action-history row. */
export enum ActionHistoryType {
  CREATE = 'CREATE',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
}

/** Payload to record one action-history entry. `T` is the shape of the before/after snapshots. */
export interface ActionHistorySaveReq<T = unknown> {
  /** Stable TypeORM `EntityMetadata.tablePath` (including schema where configured). */
  table: string;
  /** Row id the change belongs to. */
  tableId: string;
  type: ActionHistoryType;
  fromData?: T;
  toData?: T;
  note?: string;
}

/** Serialized action-history row returned to clients. */
export interface ActionHistoryDTO<T = unknown> {
  id: string;
  table: string;
  tableId: string;
  /** Trusted tenant attributed from the persisted resource scope. */
  tenantCode: string;
  type: ActionHistoryType;
  userId?: string;
  username?: string;
  fullName?: string;
  fromData?: T;
  toData?: T;
  note?: string;
  createdAt: string;
}

/** Actor (who performed the action) resolved per request. */
export interface ActionHistoryActor {
  userId?: string;
  username?: string;
  fullName?: string;
}

/**
 * Resolves the acting user for a row. Default reads `ctx.userId`; override via
 * `ActionHistoryModule.forRoot({ resolveActor })` to also supply username / fullName from your
 * own context shape.
 */
export type ActionHistoryActorResolver = (ctx: ContextService) => ActionHistoryActor;

/** DI token for the optional {@link ActionHistoryActorResolver}. */
export const ACTION_HISTORY_ACTOR_RESOLVER = Symbol('ACTION_HISTORY_ACTOR_RESOLVER');

/** Bounded query for one resource's history. Pages are zero-based; database offset is capped. */
export interface ActionHistoryQuery {
  table: string;
  tableId: string;
  pageNumber?: number;
  pageSize?: number;
}

/** Paged history response. */
export interface ActionHistoryPage<T = unknown> {
  items: ActionHistoryDTO<T>[];
  total: number;
}

/** Resource descriptor passed to the service-layer read authorization policy. */
export interface ActionHistoryAuthorizationRequest {
  context: RequestContext;
  tenantCode: string;
  table: string;
  tableId: string;
}

/**
 * Authorizes access to a resource's audit history before the query executes. Returning false is
 * indistinguishable from a missing resource (the service responds with a non-enumerating 404).
 */
export type ActionHistoryAuthorizationPolicy = (request: ActionHistoryAuthorizationRequest) => boolean | Promise<boolean>;

/** Custom snapshot transform. Mandatory built-in/configured redaction runs afterward. */
export type ActionHistorySnapshotRedactor = (snapshot: unknown, context: RequestContext) => unknown;

/** Input for resolving the audit tenant from scope values copied from the persisted resource. */
export interface ActionHistoryResourceTenantRequest {
  context: Readonly<RequestContext>;
  table: string;
  tableId: string;
  resourceScope: Readonly<Record<string, unknown>>;
  fromData?: HistoryEntry['fromData'];
  toData?: HistoryEntry['toData'];
}

/**
 * Maps a scoped resource to the `ActionHistory.tenantCode` boundary. It must be synchronous and
 * return a trusted scalar tenant. The default reads `resourceScope.tenantCode`.
 */
export type ActionHistoryResourceTenantResolver = (request: ActionHistoryResourceTenantRequest) => string | undefined;

/** Runtime security and retention policy for action history. */
export interface ActionHistorySecurityOptions {
  /** Mandatory resource-level policy for reads. Omit to deny all reads. */
  authorizeRead?: ActionHistoryAuthorizationPolicy;
  /** Additional case-insensitive field names or dotted paths to redact from snapshots. */
  redactFields?: string[];
  /** Optional transform applied before the mandatory recursive secret redactor. */
  redactSnapshot?: ActionHistorySnapshotRedactor;
  /** Required when scoped entities use a tenant property other than `tenantCode`. */
  resolveResourceTenant?: ActionHistoryResourceTenantResolver;
  /** Hard page-size ceiling. Non-finite values use 100; finite values clamp to the range 1..200. */
  maxPageSize?: number;
  /** Documentation/operations hint; the library never auto-deletes audit rows. */
  retentionDays?: number;
}

/** DI token for the resolved action-history security policy. */
export const ACTION_HISTORY_SECURITY_OPTIONS = Symbol('ACTION_HISTORY_SECURITY_OPTIONS');
