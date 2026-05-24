import 'reflect-metadata';
import {
  SearchableFields,
  getSearchableConfig,
} from '../searchable-fields.decorator';

describe('@SearchableFields', () => {
  it('attaches config metadata to class', () => {
    @SearchableFields({ exact: ['code'], contain: ['name'] })
    class Product {}
    expect(getSearchableConfig(Product)).toEqual({ exact: ['code'], contain: ['name'] });
  });

  it('preserves activeColumn when provided', () => {
    @SearchableFields({ exact: ['sku'], contain: ['title'], activeColumn: 'isActive' })
    class Item {}
    expect(getSearchableConfig(Item)?.activeColumn).toBe('isActive');
  });

  it('returns undefined for entity without decorator', () => {
    class Plain {}
    expect(getSearchableConfig(Plain)).toBeUndefined();
  });

  it('allows empty arrays (entity opted-in but no fields)', () => {
    @SearchableFields({})
    class Empty {}
    expect(getSearchableConfig(Empty)).toEqual({});
  });
});
