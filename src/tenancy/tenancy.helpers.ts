import type { Filter } from '@sdcorejs/utils/models';
import { getScopedColumns } from '../orm/decorators/tenant-scoped.decorator';

export { getScopedColumns };

/** Builds an EQUAL filter per scoped column whose scope value is present (non-null/undefined). */
export function buildScopeFilters<T = unknown>(
  scope: Record<string, unknown>,
  scopedCols: string[],
): Filter<T>[] {
  const out: Filter<T>[] = [];
  for (const col of scopedCols) {
    const value = scope[col];
    if (value === undefined || value === null) continue;
    out.push({ field: col, operator: 'EQUAL', data: value } as Filter<T>);
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
