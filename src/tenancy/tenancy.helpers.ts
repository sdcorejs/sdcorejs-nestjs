import { In } from 'typeorm';
import type { Filter } from '@sdcorejs/utils/models';
export { getScopedColumns } from '../orm/decorators/tenant-scoped.decorator';

/**
 * Builds a scope filter per scoped column whose value is present (non-null/undefined).
 * Array values produce an `IN` filter (multi-value scope, e.g. a user spanning several
 * departments); empty arrays are skipped. Scalar values produce `EQUAL`.
 */
export function buildScopeFilters<T = unknown>(
  scope: Record<string, unknown>,
  scopedCols: string[],
): Filter<T>[] {
  const out: Filter<T>[] = [];
  for (const col of scopedCols) {
    const value = scope[col];
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      out.push({ field: col, operator: 'IN', data: value } as Filter<T>);
    } else {
      out.push({ field: col, operator: 'EQUAL', data: value } as Filter<T>);
    }
  }
  return out;
}

/**
 * Builds a TypeORM `FindOptionsWhere` fragment from the current scope, for `findOne`-style reads
 * (e.g. `detail(id)`). Array values become `In(...)`; scalars are matched by equality. Null /
 * undefined / empty-array values are skipped. Returns `{}` when nothing scopes the read.
 */
export function buildScopeWhere(
  scope: Record<string, unknown>,
  scopedCols: string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const col of scopedCols) {
    const value = scope[col];
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      out[col] = In(value);
    } else {
      out[col] = value;
    }
  }
  return out;
}

/** Writes scope values into matching properties on `entity`. Skips keys not in the scope object. */
export function applyScopeToEntity(
  entity: Record<string, unknown>,
  scope: Record<string, unknown>,
  scopedCols: string[],
): void {
  for (const col of scopedCols) {
    const value = scope[col];
    if (value === undefined || value === null) continue;
    entity[col] = value;
  }
}
