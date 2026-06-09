import type { Brackets, ObjectLiteral } from 'typeorm';

export interface BaseRepositoryArgs<T = unknown> {
  /** Relations to join + select (supports nested via dot-paths, e.g. `creator.team`). */
  relations?: string[];
  /** Include soft-deleted rows (`deletedAt IS NOT NULL`). */
  withDeleted?: boolean;
  /** Custom `andWhere` clauses prepended to the filter chain. Use for non-trivial joins. */
  andWheres?: {
    where: string | Brackets | ObjectLiteral;
    parameters?: ObjectLiteral;
  }[];
  /** Reserved for future use; marker so generic type isn't structurally empty. */
  _phantom?: T;
}
