import type { RequestContext } from '../context/types';

/** Complete runtime allowlist of operations that a privileged tenancy grant may authorize. */
export const TENANCY_OPERATIONS = ['read', 'create', 'import', 'update', 'delete', 'soft-delete', 'restore'] as const;

/** Repository operation for which a privileged tenancy bypass is being consumed. */
export type TenancyOperation = (typeof TENANCY_OPERATIONS)[number];

/** Structured event passed to the mandatory audit callback on an authorized bypass grant. */
export interface TenancyBypassAuditEvent {
  actorId: string;
  reason: string;
  target: string;
  operation: TenancyOperation;
  occurredAt: Date;
}

/**
 * Explicit privileged grant for one tenancy operation.
 *
 * The strategy must derive this grant from authenticated and authorized identity. The repository
 * validates it and calls `audit` before issuing an unscoped query. A legacy boolean `true` is
 * deliberately rejected so missing tenant values can never become an implicit global bypass.
 */
export interface TenancyBypassGrant {
  authorized: true;
  actorId: string;
  reason: string;
  /** Exact TypeORM `EntityMetadata.tablePath` values this grant may bypass. `'*'` is global. */
  allowedTargets: readonly string[];
  /** Exact repository operations this grant may bypass. */
  allowedOperations: readonly TenancyOperation[];
  /** Must record synchronously and return `undefined`; async/thenable callbacks fail closed. */
  audit(event: TenancyBypassAuditEvent): void;
}

/**
 * Contract for multi-tenancy enforcement. `BaseRepository` reads `@Scoped`-marked columns
 * on the entity and, when an `ITenancyStrategy` is registered, calls these methods to:
 * - Inject a filter `EQUAL` for every read (`paging/all/search/detail`)
 * - Auto-fill the same columns on `create/import`
 *
 * Scoped entities fail closed when no strategy is registered. Unscoped entities do not call the
 * strategy. A bypass requires a validated, audited grant from `getBypassGrant`.
 */
export interface ITenancyStrategy {
  /** Returns scope values for the current request, keyed by entity column name. */
  getCurrentScope(ctx: RequestContext): Record<string, unknown>;
  /**
   * @deprecated Boolean bypass is retained only for source compatibility. Returning `true` now
   * throws `UnauthorizedTenancyBypassError`; implement `getBypassGrant` instead.
   */
  shouldBypass(ctx: RequestContext): boolean;
  /** Return an explicit authorized and auditable grant, or `undefined` for normal scoped access. */
  getBypassGrant?(ctx: RequestContext): TenancyBypassGrant | undefined;
}
