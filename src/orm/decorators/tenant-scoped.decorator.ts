import 'reflect-metadata';
import type { ClassRef } from '../types/class-ref.types';

/** Metadata key set by `@TenantScoped()` on each property. */
export const TENANT_SCOPED_METADATA = 'sdcore:tenant:scoped';
/** Metadata key set on the class listing all tenant-scoped property names. */
export const TENANT_SCOPED_COLUMNS = 'sdcore:tenant:scoped-columns';

/**
 * Marks a column as multi-tenancy-scoped. `BaseRepository` reads the metadata at runtime —
 * with `ITenancyStrategy` registered, every read injects a filter `EQUAL` and every create
 * auto-fills the column from `getCurrentScope()`. `shouldBypass(ctx)` skips both behaviors.
 *
 * @example
 * @Entity()
 * class Product extends WithAudit(BaseEntity) {
 *   @Column() @TenantScoped() tenantCode!: string;
 *   @Column() @TenantScoped() departmentCode!: string;
 * }
 */
export function TenantScoped(): PropertyDecorator {
  return (target, propertyKey) => {
    Reflect.defineMetadata(TENANT_SCOPED_METADATA, true, target, propertyKey);
    const ctor = target.constructor;
    const existing: string[] = Reflect.getOwnMetadata(TENANT_SCOPED_COLUMNS, ctor) ?? [];
    if (!existing.includes(propertyKey as string)) {
      Reflect.defineMetadata(TENANT_SCOPED_COLUMNS, [...existing, propertyKey as string], ctor);
    }
  };
}

/**
 * Returns all property names on `ctor` (and its prototype chain) marked with `@TenantScoped()`.
 * Returns `[]` if none — `BaseRepository` treats this as "tenancy disabled for this entity".
 */
export function getScopedColumns(ctor: ClassRef): string[] {
  const seen = new Set<string>();
  let current: ClassRef | null = ctor;
  while (current && (current as object) !== Object.prototype) {
    const own: string[] = Reflect.getOwnMetadata(TENANT_SCOPED_COLUMNS, current) ?? [];
    for (const name of own) seen.add(name);
    current = Object.getPrototypeOf(current);
  }
  return Array.from(seen);
}
