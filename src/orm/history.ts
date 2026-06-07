import type { QueryRunner } from 'typeorm';

/** Kind of change recorded. Matches the string values of the action-history `ActionHistoryType`. */
export type HistoryActionType = 'CREATE' | 'UPDATE' | 'DELETE';

/** One change to persist to the audit trail, emitted by `BaseRepository` CUD methods. */
export interface HistoryEntry {
  /** Resolved TypeORM table name of the changed entity. */
  table: string;
  /** Primary id of the changed row. */
  tableId: string;
  type: HistoryActionType;
  fromData?: unknown;
  toData?: unknown;
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

/**
 * Held on `globalThis` (not a module-level `let`) because the package ships one bundle per subpath
 * entry with no code-splitting: the action-history entry and the orm entry would otherwise each get
 * their OWN copy of this singleton, so `ActionHistoryModule` would register into one while
 * `BaseRepository` read another and `logHistory` rows would silently never be written. A
 * `Symbol.for` slot on `globalThis` is shared across every bundle copy in the process.
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
