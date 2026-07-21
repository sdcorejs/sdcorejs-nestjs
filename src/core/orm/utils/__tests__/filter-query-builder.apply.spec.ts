import 'reflect-metadata';
import { Brackets } from 'typeorm';
import { applyFilterToQuery, resolveColumnName, resolveSortColumn } from '../filter-query-builder';

// Minimal WhereExpressionBuilder mock that records every (sql, params) pair.
function makeQb() {
  const qb: { andWhere: jest.Mock; orWhere: jest.Mock } = {
    andWhere: jest.fn(() => qb),
    orWhere: jest.fn(() => qb),
  };
  return qb;
}

// Metadata mock; column/relation lookups are configurable per test.
function meta(opts: { col?: unknown; cols?: Record<string, unknown>; rel?: unknown } = {}) {
  return {
    findColumnWithPropertyName: jest.fn((field: string) => opts.cols?.[field] ?? opts.col),
    findRelationWithPropertyPath: jest.fn(() => opts.rel),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const lastSql = (qb: ReturnType<typeof makeQb>): string => qb.andWhere.mock.calls.at(-1)![0] as string;
const lastParams = (qb: ReturnType<typeof makeQb>): Record<string, unknown> =>
  (qb.andWhere.mock.calls.at(-1)![1] ?? {}) as Record<string, unknown>;

describe('resolveColumnName', () => {
  it('throws BadRequest on an unsafe field name (SQL-injection guard)', () => {
    expect(() => resolveColumnName('name; DROP TABLE', 'e', meta())).toThrow();
    expect(() => resolveColumnName("name'", 'e', meta())).toThrow();
  });

  it('emits a plain quoted column for a simple field', () => {
    expect(resolveColumnName('name', 'e', meta())).toBe('e."name"');
  });

  it('uses the mapped database name for a simple property', () => {
    expect(resolveColumnName('tenantCode', 'e', meta({ col: { databaseName: 'tenant_code' } }))).toBe('e."tenant_code"');
  });

  it('emits a JSON path for a jsonb column with nested segments', () => {
    const out = resolveColumnName('extraData.a.b', 'e', meta({ col: { type: 'jsonb' } }));
    expect(out).toBe(`e."extraData" -> 'a' ->> 'b'`);
  });

  it('emits a relation-aliased column for a relation path', () => {
    const out = resolveColumnName('brand.name', 'e', meta({ rel: { propertyName: 'brand' } }));
    expect(out).toBe('"brand"."name"');
  });
});

describe('resolveSortColumn', () => {
  it('throws on unsafe field', () => {
    expect(() => resolveSortColumn('a b', 'e', meta())).toThrow();
  });
  it('throws when a single-segment column does not exist', () => {
    expect(() => resolveSortColumn('ghost', 'e', meta({ col: undefined }))).toThrow();
  });
  it('returns alias.field for an existing column', () => {
    expect(resolveSortColumn('name', 'e', meta({ col: {} }))).toBe('e.name');
  });
  it('uses the mapped database name for an existing column', () => {
    expect(resolveSortColumn('tenantCode', 'e', meta({ col: { databaseName: 'tenant_code' } }))).toBe('e."tenant_code"');
  });
  it('throws when the root relation of a nested sort is unknown', () => {
    expect(() => resolveSortColumn('rel.name', 'e', meta({ rel: undefined }))).toThrow();
  });
  it('resolves a nested relation sort to underscore alias', () => {
    const m = meta({ rel: { inverseEntityMetadata: { findColumnWithPropertyName: () => ({}) } } });
    expect(resolveSortColumn('brand.name', 'e', m)).toBe('brand.name');
  });
});

describe('applyFilterToQuery — leaf operators', () => {
  const cases: Array<[string, unknown, RegExp, unknown]> = [
    ['EQUAL', 'x', / = :/, 'x'],
    ['NOT_EQUAL', 'x', / != :/, 'x'],
    ['LESS_THAN', 5, / < :/, 5],
    ['LESS_OR_EQUAL', 5, / <= :/, 5],
    ['GREATER_THAN', 5, / > :/, 5],
    ['GREATER_OR_EQUAL', 5, / >= :/, 5],
    ['CONTAIN', 'a', /LIKE/, '%a%'],
    ['NOT_CONTAIN', 'a', /NOT LIKE/, '%a%'],
    ['START_WITH', 'a', /LIKE/, 'a%'],
    ['NOT_START_WITH', 'a', /NOT LIKE/, 'a%'],
    ['END_WITH', 'a', /LIKE/, '%a'],
    ['NOT_END_WITH', 'a', /NOT LIKE/, '%a'],
  ];
  it.each(cases)('%s builds parameterized SQL', (operator, data, sqlRe, expectedParam) => {
    const qb = makeQb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    applyFilterToQuery(qb as any, { field: 'name', operator, data } as any, 0, 'e', meta());
    expect(lastSql(qb)).toMatch(sqlRe);
    expect(Object.values(lastParams(qb))[0]).toEqual(expectedParam);
  });

  it('IN / NOT_IN spread arrays', () => {
    const qb = makeQb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    applyFilterToQuery(qb as any, { field: 'id', operator: 'IN', data: ['a', 'b'] } as any, 1, 'e', meta());
    expect(lastSql(qb)).toMatch(/IN \(:\.\.\./);
    expect(Object.values(lastParams(qb))[0]).toEqual(['a', 'b']);
  });

  it('maps empty IN to false and empty NOT_IN to a no-op', () => {
    const include = makeQb();
    const exclude = makeQb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    applyFilterToQuery(include as any, { field: 'id', operator: 'IN', data: [] } as any, 1, 'e', meta());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    applyFilterToQuery(exclude as any, { field: 'id', operator: 'NOT_IN', data: [] } as any, 2, 'e', meta());
    expect(lastSql(include)).toBe('1 = 0');
    expect(exclude.andWhere).not.toHaveBeenCalled();
  });

  it('resolves a field operand to a quoted RHS column without binding it as a literal', () => {
    const qb = makeQb();
    const metadata = meta({ cols: { price: { databaseName: 'price' }, cost: { databaseName: 'unit_cost' } } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    applyFilterToQuery(qb as any, { field: 'price', operator: 'GREATER_THAN', dataType: 'field', data: 'cost' } as any, 3, 'e', metadata);
    expect(lastSql(qb)).toBe('e."price" > e."unit_cost"');
    expect(lastParams(qb)).toEqual({});
  });

  it('uses PostgreSQL array membership semantics for a field operand', () => {
    const qb = makeQb();
    const metadata = meta({ cols: { code: {}, allowedCodes: { isArray: true } } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    applyFilterToQuery(qb as any, { field: 'code', operator: 'IN', dataType: 'field', data: 'allowedCodes' } as any, 4, 'e', metadata);
    expect(lastSql(qb)).toContain('ANY(e."allowedCodes")');
    expect(lastParams(qb)).toEqual({});
  });

  it('rejects field membership when the RHS column is not a PostgreSQL array', () => {
    const qb = makeQb();
    const metadata = meta({ cols: { code: {}, otherCode: { isArray: false } } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() =>
      applyFilterToQuery(qb as any, { field: 'code', operator: 'IN', dataType: 'field', data: 'otherCode' } as any, 4, 'e', metadata),
    ).toThrow();
    expect(qb.andWhere).not.toHaveBeenCalled();
  });

  it.each([
    ['date-today', 'TODAY', undefined],
    ['date-relative', { amount: 2, direction: 'previous', unit: 'day' }, -2],
  ])('resolves %s operands to deterministic Date parameters', (dataType, data, dayOffset) => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-21T10:30:00.000Z'));
    try {
      const qb = makeQb();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      applyFilterToQuery(qb as any, { field: 'createdAt', operator: 'GREATER_OR_EQUAL', dataType, data } as any, 5, 'e', meta());
      const value = Object.values(lastParams(qb))[0];
      expect(value).toBeInstanceOf(Date);
      const expected = new Date();
      expected.setHours(0, 0, 0, 0);
      if (dayOffset !== undefined) expected.setDate(expected.getDate() + dayOffset);
      expect((value as Date).getTime()).toBe(expected.getTime());
    } finally {
      jest.useRealTimers();
    }
  });

  it('converts explicit numeric timestamp units to Date parameters', () => {
    const qb = makeQb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    applyFilterToQuery(
      qb as any,
      { field: 'createdAt', operator: 'GREATER_OR_EQUAL', timestampUnit: 'seconds', data: 1_700_000_000 } as any,
      6,
      'e',
      meta({ col: { type: 'timestamp' } }),
    );
    expect((Object.values(lastParams(qb))[0] as Date).getTime()).toBe(1_700_000_000_000);
  });

  it('resolves relative dates back to explicit epoch units for numeric date columns', () => {
    const qb = makeQb();
    const now = new Date('2026-07-21T10:30:00.000Z');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    applyFilterToQuery(
      qb as any,
      {
        field: 'createdAtEpoch',
        operator: 'GREATER_OR_EQUAL',
        dataType: 'date-relative',
        timestampUnit: 'seconds',
        data: { amount: 1, direction: 'previous', unit: 'hour' },
      } as any,
      7,
      'e',
      meta({ col: { type: 'bigint' } }),
      now,
    );
    expect(Object.values(lastParams(qb))[0]).toBe((now.getTime() - 3_600_000) / 1000);
  });

  it('BETWEEN binds _from and _to', () => {
    const qb = makeQb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    applyFilterToQuery(qb as any, { field: 'age', operator: 'BETWEEN', data: { from: 1, to: 9 } } as any, 2, 'e', meta());
    expect(lastSql(qb)).toMatch(/>= :.*_from AND .* <= :.*_to/);
    const p = lastParams(qb);
    expect(Object.values(p)).toEqual(expect.arrayContaining([1, 9]));
  });

  it('NULL / NOT_NULL emit IS [NOT] NULL with no params', () => {
    const qb = makeQb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    applyFilterToQuery(qb as any, { field: 'deletedAt', operator: 'NULL' } as any, 0, 'e', meta());
    expect(lastSql(qb)).toBe('e."deletedAt" IS NULL');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    applyFilterToQuery(qb as any, { field: 'deletedAt', operator: 'NOT_NULL' } as any, 0, 'e', meta());
    expect(lastSql(qb)).toBe('e."deletedAt" IS NOT NULL');
  });

  it('skips a leaf whose data is null/undefined', () => {
    const qb = makeQb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    applyFilterToQuery(qb as any, { field: 'name', operator: 'EQUAL', data: null } as any, 0, 'e', meta());
    expect(qb.andWhere).not.toHaveBeenCalled();
  });

  it('throws on an unsafe leaf field', () => {
    const qb = makeQb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => applyFilterToQuery(qb as any, { field: 'a;b', operator: 'EQUAL', data: 1 } as any, 0, 'e', meta())).toThrow();
  });

  it('throws on an unsupported operator when called directly', () => {
    const qb = makeQb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => applyFilterToQuery(qb as any, { field: 'name', operator: 'EXPLOIT', data: 1 } as any, 0, 'e', meta())).toThrow();
    expect(qb.andWhere).not.toHaveBeenCalled();
  });
});

describe('applyFilterToQuery — AND/OR recursion', () => {
  it('AND wraps children with andWhere brackets', () => {
    const qb = makeQb();
    const group = {
      operator: 'AND',
      data: [
        { field: 'a', operator: 'EQUAL', data: 1 },
        { field: 'b', operator: 'EQUAL', data: 2 },
      ],
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    applyFilterToQuery(qb as any, group as any, 0, 'e', meta());
    const bracket = qb.andWhere.mock.calls[0][0];
    expect(bracket).toBeInstanceOf(Brackets);
    const sub = makeQb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (bracket as Brackets).whereFactory(sub as any);
    expect(sub.andWhere).toHaveBeenCalledTimes(2);
    expect(sub.orWhere).not.toHaveBeenCalled();
  });

  it('OR wraps children with orWhere brackets', () => {
    const qb = makeQb();
    const group = {
      operator: 'OR',
      data: [
        { field: 'a', operator: 'EQUAL', data: 1 },
        { field: 'b', operator: 'EQUAL', data: 2 },
      ],
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    applyFilterToQuery(qb as any, group as any, 0, 'e', meta());
    const bracket = qb.andWhere.mock.calls[0][0] as Brackets;
    const sub = makeQb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    bracket.whereFactory(sub as any);
    expect(sub.orWhere).toHaveBeenCalledTimes(2);
  });

  it('skips an empty AND/OR group', () => {
    const qb = makeQb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    applyFilterToQuery(qb as any, { operator: 'AND', data: [] } as any, 0, 'e', meta());
    expect(qb.andWhere).not.toHaveBeenCalled();
  });
});
