import type { ContextService } from '../../context/context.service';

/** Kind of change recorded in an action-history row. */
export enum ActionHistoryType {
  CREATE = 'CREATE',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
}

/** Payload to record one action-history entry. `T` is the shape of the before/after snapshots. */
export interface ActionHistorySaveReq<T = unknown> {
  /** Logical table / entity name the change belongs to. */
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
