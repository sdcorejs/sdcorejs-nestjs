import 'reflect-metadata';
import type { ClassRef } from '../types/class-ref.types';

export const SEARCHABLE_FIELDS_METADATA = 'sdcore:searchable';

export interface SearchableFieldsConfig {
  /** Columns matched exactly (`column = :term`). Typical: `code`, `sku`, `username`. */
  exact?: string[];
  /** Columns matched via `LOWER(UNACCENT(col)) LIKE LOWER(UNACCENT(%term%))`. Typical: `name`, `description`. */
  contain?: string[];
  /** Optional boolean column gating `contain` matches (only active rows surface as suggestions). */
  activeColumn?: string;
}

/**
 * Declares the search-friendly columns on an entity. `BaseRepository.search(keyword, filters)`
 * reads this metadata; entities without `@SearchableFields()` return `[]` — no implicit field
 * inference, no "magic" guessing of column names.
 *
 * @example
 * @SearchableFields({ exact: ['code', 'sku'], contain: ['name'], activeColumn: 'isActive' })
 * @Entity()
 * class Product extends WithAudit(BaseEntity) { ... }
 */
export function SearchableFields(config: SearchableFieldsConfig): ClassDecorator {
  return (target) => {
    Reflect.defineMetadata(SEARCHABLE_FIELDS_METADATA, config, target);
  };
}

/**
 * Returns the `SearchableFieldsConfig` declared on `ctor`, or `undefined` if no decorator
 * was applied. `BaseRepository.search` interprets `undefined` as "no searchable fields".
 */
export function getSearchableConfig(ctor: ClassRef): SearchableFieldsConfig | undefined {
  return Reflect.getMetadata(SEARCHABLE_FIELDS_METADATA, ctor);
}
