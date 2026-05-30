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
 * Persists {@link HistoryEntry} rows. Implemented by `@sdcorejs/nestjs/action-history`'s
 * `ActionHistoryService` and registered via {@link registerHistoryRecorder}. Kept as an interface
 * so `orm` does NOT depend on the action-history module (the dependency points the other way).
 */
export interface IHistoryRecorder {
  record(entry: HistoryEntry): Promise<void>;
}

let _recorder: IHistoryRecorder | undefined;

/**
 * Register the process-wide history recorder. Called once at bootstrap by the action-history module.
 * A repository created with `{ logHistory: true }` and no explicit `historyRecorder` uses this one.
 */
export const registerHistoryRecorder = (recorder: IHistoryRecorder): void => {
  _recorder = recorder;
};

/** The globally-registered recorder, if any. */
export const getHistoryRecorder = (): IHistoryRecorder | undefined => _recorder;
