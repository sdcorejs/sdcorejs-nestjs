import { BadRequestException } from '@nestjs/common';
import {
  Brackets,
  type EntityMetadata,
  type WhereExpressionBuilder,
} from 'typeorm';
import type { Filter, FilterAndOr, Order } from '@sdcorejs/utils/models';
import { apiError } from '../types/api-response.types';

/** Safe-character regex for field paths. Used as SQL injection guard before interpolation. */
const SAFE_FIELD = /^[a-zA-Z0-9_.]+$/;

/**
 * Drop empty / null / undefined filter entries. Recurse into AND/OR; if an AND/OR's inner
 * set becomes empty after cleanup, drop the whole AND/OR entry too. Preserve `from=0`/`to=0`
 * in BETWEEN by checking `!== undefined && !== null` (avoid truthy-check bug from `be-masterdata`).
 */
export function prepareFilter<T>(filters: Filter<T>[] | undefined): Filter<T>[] {
  if (!Array.isArray(filters)) return [];
  const out: Filter<T>[] = [];

  for (const f of filters) {
    const op = f.operator;

    if (op === 'AND' || op === 'OR') {
      const cleaned = prepareFilter((f as FilterAndOr<T>).data);
      if (cleaned.length) out.push({ ...(f as FilterAndOr<T>), data: cleaned });
      continue;
    }

    // Leaf filter — must have field
    const leaf = f as Exclude<Filter<T>, FilterAndOr<T>>;
    if (!('field' in leaf) || !leaf.field) continue;

    if (op === 'NULL' || op === 'NOT_NULL') {
      out.push(leaf);
      continue;
    }

    if (!('data' in leaf)) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = (leaf as any).data;

    if (op === 'IN' || op === 'NOT_IN') {
      if (Array.isArray(data) && data.length > 0) out.push(leaf);
      continue;
    }
    if (op === 'BETWEEN') {
      if (
        typeof data === 'object' &&
        data !== null &&
        'from' in data &&
        data.from !== undefined &&
        data.from !== null &&
        'to' in data &&
        data.to !== undefined &&
        data.to !== null
      ) {
        out.push(leaf);
      }
      continue;
    }
    if (data !== undefined && data !== null) out.push(leaf);
  }

  return out;
}

/** Drop sort entries that are missing `field` or `direction`. Identity for valid lists. */
export function prepareSorts<T>(sorts: Order<T>[] | undefined): Order<T>[] {
  if (!Array.isArray(sorts)) return [];
  return sorts.filter((s) => !!s.field && !!s.direction);
}

/**
 * Resolve a field path to a quoted SQL column reference under `alias`.
 *
 * Rules:
 * 1. Field must match `[a-zA-Z0-9_.]+` — anything else throws `BadRequestException` (injection guard).
 * 2. If root prop is a JSON/JSONB column and path has nested segments → emit `-> 'k' -> 'k' ->> 'last'`.
 * 3. If root prop is a relation and path has nested segments → emit `"relationAlias"."child"`.
 * 4. Otherwise emit `alias."field"`.
 */
export function resolveColumnName(field: string, alias: string, metadata: EntityMetadata): string {
  if (!SAFE_FIELD.test(field)) {
    throw new BadRequestException(apiError('core.repository.invalid-field-name', 'Invalid field name', { field }));
  }

  const parts = field.split('.');
  const rootProp = parts[0];

  const col = metadata.findColumnWithPropertyName(rootProp);
  if (col && (col.type === 'jsonb' || col.type === 'json' || col.type === 'simple-json')) {
    if (parts.length > 1) {
      const jsonPath = parts.slice(1);
      const path = jsonPath
        .map((p, i) => (i === jsonPath.length - 1 ? `->> '${p}'` : `-> '${p}'`))
        .join(' ');
      return `${alias}."${rootProp}" ${path}`;
    }
  }

  const rel = metadata.findRelationWithPropertyPath(rootProp);
  if (rel && parts.length > 1) {
    const relationAlias = rootProp;
    const childField = parts.slice(1).join('.');
    return `"${relationAlias}"."${childField}"`;
  }

  return `${alias}."${field}"`;
}

/**
 * Resolve a sort field path. Validates that the column actually exists in entity metadata
 * (BaseRepository wants strict failure on bad sort fields — silently dropping yields
 * unpredictable ORDER BY).
 *
 * For nested paths `family.members.name`, join alias is `family_members` (underscores).
 */
export function resolveSortColumn(field: string, alias: string, metadata: EntityMetadata): string {
  if (!SAFE_FIELD.test(field)) {
    throw new BadRequestException(apiError('core.repository.invalid-sort-field', 'Invalid sort field', { field }));
  }

  const parts = field.split('.');

  if (parts.length === 1) {
    const col = metadata.findColumnWithPropertyName(parts[0]);
    if (!col) {
      throw new BadRequestException(apiError('core.repository.column-not-found', 'Column not found in entity', { field }));
    }
    return `${alias}.${field}`;
  }

  const rootRelation = parts[0];
  const rel = metadata.findRelationWithPropertyPath(rootRelation);
  if (!rel) {
    throw new BadRequestException(apiError('core.repository.relation-not-found', 'Relation not found', { relation: rootRelation }));
  }

  const aliasName = parts.slice(0, -1).join('_');
  const columnName = parts[parts.length - 1];

  let currentMeta = rel.inverseEntityMetadata;
  for (let i = 1; i < parts.length - 1; i++) {
    const next = currentMeta.findRelationWithPropertyPath(parts[i]);
    if (!next) {
      throw new BadRequestException(
        apiError('core.repository.relation-not-found-in', 'Relation not found in parent entity', {
          relation: parts[i],
          parent: currentMeta.name,
        }),
      );
    }
    currentMeta = next.inverseEntityMetadata;
  }

  const finalCol = currentMeta.findColumnWithPropertyName(columnName);
  if (!finalCol) {
    throw new BadRequestException(
      apiError('core.repository.column-not-found-in', 'Column not found in entity', {
        column: columnName,
        parent: currentMeta.name,
      }),
    );
  }

  return `${aliasName}.${columnName}`;
}

/**
 * Apply a single filter (leaf or AND/OR group) to a `WhereExpressionBuilder`. Recurses for
 * groups, builds parameterized SQL for every leaf operator. Unique parameter names per call
 * avoid collisions even within deep nested groups.
 */
export function applyFilterToQuery<T>(
  qb: WhereExpressionBuilder,
  filter: Filter<T>,
  idx: number,
  alias: string,
  metadata: EntityMetadata,
): void {
  const op = filter.operator;

  if (op === 'AND' || op === 'OR') {
    const sub = (filter as FilterAndOr<T>).data;
    if (!Array.isArray(sub) || sub.length === 0) return;
    qb.andWhere(
      new Brackets((sqb) => {
        sub.forEach((s, j) => {
          const nestedIdx = idx * 1000 + j;
          const wrap = new Brackets((iqb) => applyFilterToQuery(iqb, s, nestedIdx, alias, metadata));
          if (op === 'OR') sqb.orWhere(wrap);
          else sqb.andWhere(wrap);
        });
      }),
    );
    return;
  }

  const leaf = filter as Exclude<Filter<T>, FilterAndOr<T>>;
  if (!('field' in leaf) || !leaf.field) return;

  const col = resolveColumnName(leaf.field as string, alias, metadata);

  if (op === 'NULL') {
    qb.andWhere(`${col} IS NULL`);
    return;
  }
  if (op === 'NOT_NULL') {
    qb.andWhere(`${col} IS NOT NULL`);
    return;
  }

  if (!('data' in leaf)) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = (leaf as any).data;
  if (data === undefined || data === null) return;

  const param = `p_${idx}_${Math.random().toString(36).slice(2, 8)}`;

  switch (op) {
    case 'EQUAL':
      qb.andWhere(`${col} = :${param}`, { [param]: data });
      return;
    case 'NOT_EQUAL':
      qb.andWhere(`${col} != :${param}`, { [param]: data });
      return;
    case 'LESS_THAN':
      qb.andWhere(`${col} < :${param}`, { [param]: data });
      return;
    case 'LESS_OR_EQUAL':
      qb.andWhere(`${col} <= :${param}`, { [param]: data });
      return;
    case 'GREATER_THAN':
      qb.andWhere(`${col} > :${param}`, { [param]: data });
      return;
    case 'GREATER_OR_EQUAL':
      qb.andWhere(`${col} >= :${param}`, { [param]: data });
      return;
    case 'CONTAIN':
      qb.andWhere(`LOWER(UNACCENT(${col}::text)) LIKE LOWER(UNACCENT(:${param}))`, { [param]: `%${data}%` });
      return;
    case 'NOT_CONTAIN':
      qb.andWhere(`LOWER(UNACCENT(${col}::text)) NOT LIKE LOWER(UNACCENT(:${param}))`, { [param]: `%${data}%` });
      return;
    case 'START_WITH':
      qb.andWhere(`LOWER(UNACCENT(${col}::text)) LIKE LOWER(UNACCENT(:${param}))`, { [param]: `${data}%` });
      return;
    case 'NOT_START_WITH':
      qb.andWhere(`LOWER(UNACCENT(${col}::text)) NOT LIKE LOWER(UNACCENT(:${param}))`, { [param]: `${data}%` });
      return;
    case 'END_WITH':
      qb.andWhere(`LOWER(UNACCENT(${col}::text)) LIKE LOWER(UNACCENT(:${param}))`, { [param]: `%${data}` });
      return;
    case 'NOT_END_WITH':
      qb.andWhere(`LOWER(UNACCENT(${col}::text)) NOT LIKE LOWER(UNACCENT(:${param}))`, { [param]: `%${data}` });
      return;
    case 'BETWEEN':
      qb.andWhere(`${col} >= :${param}_from AND ${col} <= :${param}_to`, {
        [`${param}_from`]: data.from,
        [`${param}_to`]: data.to,
      });
      return;
    case 'IN':
      qb.andWhere(`${col} IN (:...${param})`, { [param]: data });
      return;
    case 'NOT_IN':
      qb.andWhere(`${col} NOT IN (:...${param})`, { [param]: data });
      return;
    default:
      qb.andWhere(`${col} = :${param}`, { [param]: data });
  }
}
