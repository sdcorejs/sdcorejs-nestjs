import { In } from 'typeorm';
import type { Filter } from '@sdcorejs/utils/models';
import { getScopedColumnMetadata, getScopedColumns, type ScopedColumnMetadata } from '../orm/decorators/scoped.decorator';
import { InvalidTenancyScopeError, MissingTenancyScopeError } from './errors';

export { getScopedColumnMetadata, getScopedColumns };

/** Backward-compatible input accepted by the public pure scope helpers. Strings are required. */
export type ScopedColumnInput = string | ScopedColumnMetadata;

/** Validated canonical scope predicate consumed by reads, joins, and mutations. */
export interface ResolvedScopePredicate {
  propertyName: string;
  required: boolean;
  operator: 'EQUAL' | 'IN';
  values: readonly unknown[];
}

function normalizeColumns(columns: readonly ScopedColumnInput[]): ScopedColumnMetadata[] {
  return columns.map((column) => (typeof column === 'string' ? { propertyName: column, required: true } : column));
}

function isScalar(value: unknown): boolean {
  return (
    (typeof value === 'string' && value.trim().length > 0) ||
    (typeof value === 'number' && Number.isFinite(value)) ||
    typeof value === 'boolean' ||
    typeof value === 'bigint' ||
    (value instanceof Date && Number.isFinite(value.getTime()))
  );
}

function normalizeAllowedValues(column: string, value: unknown[]): unknown[] {
  const values = value.filter((item) => item !== undefined && item !== null);
  if (values.some((item) => !isScalar(item))) {
    throw new InvalidTenancyScopeError(column, 'allowed values must be scalar');
  }
  return Array.from(new Set(values));
}

function assertRequiredScope(scope: Record<string, unknown>, columns: readonly ScopedColumnMetadata[]): void {
  const missing = columns
    .filter((column) => column.required && (scope[column.propertyName] === undefined || scope[column.propertyName] === null))
    .map((column) => column.propertyName);
  if (missing.length) throw new MissingTenancyScopeError(missing);
}

/** Resolve and validate scope values once so every query path observes identical semantics. */
export function resolveScopePredicates(
  scope: Record<string, unknown>,
  scopedColumns: readonly ScopedColumnInput[],
): ResolvedScopePredicate[] {
  const columns = normalizeColumns(scopedColumns);
  assertRequiredScope(scope, columns);
  const predicates: ResolvedScopePredicate[] = [];
  for (const { propertyName, required } of columns) {
    const value = scope[propertyName];
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      predicates.push({ propertyName, required, operator: 'IN', values: normalizeAllowedValues(propertyName, value) });
      continue;
    }
    if (!isScalar(value)) throw new InvalidTenancyScopeError(propertyName, 'value must be scalar or an array of scalars');
    predicates.push({ propertyName, required, operator: 'EQUAL', values: [value] });
  }
  return predicates;
}

/**
 * Builds one filter per configured scope dimension.
 *
 * Missing required values throw. Missing optional values are omitted. An explicitly empty allowed
 * set remains an `IN []` filter; `applyFilterToQuery` converts it to `1 = 0` instead of dropping it.
 */
export function buildScopeFilters<T = unknown>(scope: Record<string, unknown>, scopedColumns: readonly ScopedColumnInput[]): Filter<T>[] {
  return resolveScopePredicates(scope, scopedColumns).map((predicate) =>
    predicate.operator === 'IN'
      ? ({ field: predicate.propertyName, operator: 'IN', data: [...predicate.values] } as Filter<T>)
      : ({ field: predicate.propertyName, operator: 'EQUAL', data: predicate.values[0] } as Filter<T>),
  );
}

/**
 * Builds a TypeORM criteria fragment from the current scope.
 * Empty arrays intentionally become `In([])`, which TypeORM renders as a match-zero predicate.
 */
export function buildScopeWhere(scope: Record<string, unknown>, scopedColumns: readonly ScopedColumnInput[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const predicate of resolveScopePredicates(scope, scopedColumns)) {
    out[predicate.propertyName] = predicate.operator === 'IN' ? In([...predicate.values]) : predicate.values[0];
  }
  return out;
}

/**
 * Applies a validated write scope to a new entity.
 *
 * Scalar values override caller input. For a multi-value scope, the caller must select one allowed
 * scalar value on the entity (a single allowed value is selected automatically). This prevents an
 * allowed-values array from being persisted into a scalar tenant column.
 */
export function applyScopeToEntity(
  entity: Record<string, unknown>,
  scope: Record<string, unknown>,
  scopedColumns: readonly ScopedColumnInput[],
): void {
  const columns = normalizeColumns(scopedColumns);
  assertRequiredScope(scope, columns);
  for (const { propertyName } of columns) {
    const value = scope[propertyName];
    if (value === undefined || value === null) continue;
    if (!Array.isArray(value)) {
      if (!isScalar(value)) throw new InvalidTenancyScopeError(propertyName, 'write value must be scalar');
      entity[propertyName] = value;
      continue;
    }

    const allowed = normalizeAllowedValues(propertyName, value);
    if (!allowed.length) throw new InvalidTenancyScopeError(propertyName, 'allowed values are empty');
    const selected = entity[propertyName];
    if (selected === undefined || selected === null) {
      if (allowed.length === 1) {
        entity[propertyName] = allowed[0];
        continue;
      }
      throw new InvalidTenancyScopeError(propertyName, 'a write scope must be selected from the allowed values');
    }
    if (!isScalar(selected) || !allowed.some((item) => Object.is(item, selected))) {
      throw new InvalidTenancyScopeError(propertyName, 'selected write scope is not allowed');
    }
  }
}
