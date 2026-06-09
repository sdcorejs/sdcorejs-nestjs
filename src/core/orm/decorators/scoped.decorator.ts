import 'reflect-metadata';
import type { ClassRef } from '../types/class-ref.types';

/** Metadata key set by `@Scoped()` on each property. */
export const SCOPED_METADATA = 'sdcore:scoped';
/** Metadata key set on the class listing all scoped property names. */
export const SCOPED_COLUMNS = 'sdcore:scoped-columns';

/**
 * Marks a column as scope-enforced. `BaseRepository` reads the metadata at runtime — with
 * `ITenancyStrategy` registered, every read injects a filter (scalar → `EQUAL`, array → `IN`) and
 * every create auto-fills the column from `getCurrentScope()`. `shouldBypass(ctx)` skips both.
 *
 * The column name is the decorated property name — the library never hardcodes one. Use it for any
 * scope dimension (tenant, department, org, project, …).
 *
 * @example
 * @Entity()
 * class Product extends WithAudit(BaseEntity) {
 *   @Column() @Scoped() tenantCode!: string;
 *   @Column() @Scoped() departmentCode!: string;
 * }
 */
export function Scoped(): PropertyDecorator {
  return (target, propertyKey) => {
    Reflect.defineMetadata(SCOPED_METADATA, true, target, propertyKey);
    const ctor = target.constructor;
    const existing: string[] = Reflect.getOwnMetadata(SCOPED_COLUMNS, ctor) ?? [];
    if (!existing.includes(propertyKey as string)) {
      Reflect.defineMetadata(SCOPED_COLUMNS, [...existing, propertyKey as string], ctor);
    }
  };
}

/**
 * Returns all property names on `ctor` (and its prototype chain) marked with `@Scoped()`.
 * Returns `[]` if none — `BaseRepository` treats this as "scoping disabled for this entity".
 */
export function getScopedColumns(ctor: ClassRef): string[] {
  const seen = new Set<string>();
  let current: ClassRef | null = ctor;
  while (current && (current as object) !== Object.prototype) {
    const own: string[] = Reflect.getOwnMetadata(SCOPED_COLUMNS, current) ?? [];
    for (const name of own) seen.add(name);
    current = Object.getPrototypeOf(current);
  }
  return Array.from(seen);
}
