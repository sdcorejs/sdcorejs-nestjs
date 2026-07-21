import 'reflect-metadata';
import { prepareFilter, prepareSorts } from './filter-query-builder';
import type { Filter, Order } from '@sdcorejs/utils/models';

describe('prepareFilter', () => {
  it('returns [] for non-array input', () => {
    expect(prepareFilter(undefined)).toEqual([]);
    expect(prepareFilter(null as unknown as Filter[])).toEqual([]);
  });

  it('rejects leaf filters without field', () => {
    const f = [{ operator: 'EQUAL', data: 'x' }] as unknown as Filter[];
    expect(() => prepareFilter(f)).toThrow();
  });

  it('drops filters with null/undefined data (except NULL operators)', () => {
    const f: Filter[] = [
      { field: 'name', operator: 'EQUAL', data: null },
      { field: 'code', operator: 'EQUAL', data: undefined },
      { field: 'price', operator: 'EQUAL', data: 0 }, // 0 must NOT be dropped
    ];
    expect(prepareFilter(f)).toHaveLength(1);
    expect((prepareFilter(f)[0] as Filter & { data: number }).data).toBe(0);
  });

  it('keeps NULL / NOT_NULL with no data', () => {
    const f: Filter[] = [
      { field: 'deletedAt', operator: 'NULL' },
      { field: 'deletedAt', operator: 'NOT_NULL' },
    ];
    expect(prepareFilter(f)).toHaveLength(2);
  });

  it('keeps empty IN so the query builder can produce an always-false predicate', () => {
    const f: Filter[] = [
      { field: 'id', operator: 'IN', data: [] },
      { field: 'id', operator: 'IN', data: ['a', 'b'] },
    ];
    expect(prepareFilter(f)).toEqual(f);
  });

  it('rejects malformed BETWEEN and keeps zero bounds', () => {
    expect(() => prepareFilter([{ field: 'price', operator: 'BETWEEN', data: { from: 1, to: undefined } as never }])).toThrow();
    const valid: Filter[] = [{ field: 'price', operator: 'BETWEEN', data: { from: 0, to: 0 } }];
    expect(prepareFilter(valid)).toEqual(valid);
  });

  it('recurses into AND/OR; drops empty groups', () => {
    const f: Filter[] = [
      {
        operator: 'AND',
        data: [
          { field: 'name', operator: 'EQUAL', data: null },
          { field: 'price', operator: 'EQUAL', data: 100 },
        ],
      },
      {
        operator: 'OR',
        data: [{ field: 'x', operator: 'EQUAL', data: null }],
      },
    ];
    const out = prepareFilter(f);
    expect(out).toHaveLength(1);
    expect((out[0] as { data: Filter[] }).data).toHaveLength(1);
  });

  it('preserves nested AND inside OR with valid leaves', () => {
    const f: Filter[] = [
      {
        operator: 'OR',
        data: [
          { field: 'a', operator: 'EQUAL', data: 1 },
          {
            operator: 'AND',
            data: [
              { field: 'b', operator: 'EQUAL', data: 2 },
              { field: 'c', operator: 'EQUAL', data: 3 },
            ],
          },
        ],
      },
    ];
    const out = prepareFilter(f);
    expect(out).toHaveLength(1);
    const orData = (out[0] as { data: Filter[] }).data;
    expect(orData).toHaveLength(2);
  });

  it('rejects unsupported operators instead of silently treating them as EQUAL', () => {
    expect(() => prepareFilter([{ field: 'name', operator: 'EXPLOIT', data: 'x' } as never])).toThrow();
  });

  it('rejects accessor-backed filter properties without invoking the accessor', () => {
    const getter = jest.fn(() => 'EQUAL');
    const filter = { field: 'name', data: 'x' } as Record<string, unknown>;
    Object.defineProperty(filter, 'operator', { enumerable: true, get: getter });

    expect(() => prepareFilter([filter as never])).toThrow();
    expect(getter).not.toHaveBeenCalled();
  });

  it('preserves utils 1.2 operand metadata after validation', () => {
    const filters: Filter[] = [
      { field: 'price', operator: 'GREATER_THAN', dataType: 'field', data: 'cost' },
      { field: 'createdAt', operator: 'GREATER_OR_EQUAL', dataType: 'date-today', data: 'TODAY' },
      {
        field: 'createdAt',
        operator: 'GREATER_OR_EQUAL',
        dataType: 'date-relative',
        data: { amount: 7, direction: 'previous', unit: 'day' },
      },
      { field: 'createdAt', operator: 'GREATER_OR_EQUAL', timestampUnit: 'seconds', data: 1_700_000_000 },
    ];

    expect(prepareFilter(filters)).toEqual(filters);
  });

  it('keeps field-backed membership filters for SQL array handling', () => {
    const filters: Filter[] = [{ field: 'code', operator: 'IN', dataType: 'field', data: 'allowedCodes' }];
    expect(prepareFilter(filters)).toEqual(filters);
  });
});

describe('prepareSorts', () => {
  it('returns [] for non-array input', () => {
    expect(prepareSorts(undefined)).toEqual([]);
  });

  it('drops sorts missing field or direction', () => {
    const s = [
      { field: 'name', direction: 'ASC' },
      { field: '', direction: 'DESC' },
      { field: 'code', direction: '' },
    ] as Order[];
    expect(prepareSorts(s)).toEqual([{ field: 'name', direction: 'ASC' }]);
  });
});
