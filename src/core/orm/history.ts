import type { QueryRunner } from 'typeorm';

/** Kind of change recorded. Matches the string values of the action-history `ActionHistoryType`. */
export type HistoryActionType = 'CREATE' | 'UPDATE' | 'DELETE';

/** One change to persist to the audit trail, emitted by `BaseRepository` CUD methods. */
export interface HistoryEntry {
  /** Stable, schema-qualified TypeORM `EntityMetadata.tablePath` of the changed entity. */
  table: string;
  /** Primary id of the changed row. */
  tableId: string;
  type: HistoryActionType;
  fromData?: unknown;
  toData?: unknown;
  /** Scope values copied from the persisted resource row, never from request input alone. */
  resourceScope?: Readonly<Record<string, unknown>>;
  /** Active transaction, so the history row is written in the same unit of work. */
  queryRunner?: QueryRunner;
}

/**
 * Persists {@link HistoryEntry} rows. Implemented by `@sdcorejs/nestjs/features`'s
 * `ActionHistoryService` and registered via {@link registerHistoryRecorder}. Kept as an interface
 * so `orm` does NOT depend on the action-history module (the dependency points the other way).
 */
export interface IHistoryRecorder {
  record(entry: HistoryEntry): Promise<void>;
}

/** Raised before commit when a scoped persisted row cannot provide its complete history scope. */
export class MissingHistoryResourceScopeError extends Error {
  constructor() {
    super('A scoped persisted row did not expose the resource scope required for action history');
    this.name = 'MissingHistoryResourceScopeError';
  }
}

/**
 * Held on `globalThis` (not a module-level `let`) because consumers can load different public
 * subpaths or physical dependency copies. The action-history and ORM module graphs could otherwise
 * receive different copies of this singleton, so `ActionHistoryModule` would register into one
 * while `BaseRepository` read another and `logHistory` rows would silently never be written. A
 * `Symbol.for` slot on `globalThis` is shared across every package graph in the process.
 */
const SLOT = Symbol.for('@sdcorejs/nestjs:history-recorder');
interface Holder {
  current?: IHistoryRecorder;
}
const holder: Holder = ((globalThis as Record<symbol, unknown>)[SLOT] as Holder) ?? {};
(globalThis as Record<symbol, unknown>)[SLOT] = holder;

/**
 * Register the process-wide history recorder. Called once at bootstrap by the action-history module.
 * A repository created with `{ logHistory: true }` and no explicit `historyRecorder` uses this one.
 */
export const registerHistoryRecorder = (recorder: IHistoryRecorder): void => {
  holder.current = recorder;
};

/** The globally-registered recorder, if any. */
export const getHistoryRecorder = (): IHistoryRecorder | undefined => holder.current;
