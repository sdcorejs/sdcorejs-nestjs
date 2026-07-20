import 'reflect-metadata';
import type { ClassRef } from '../types/class-ref.types';

/** Metadata key set by `@Scoped()` on each property. */
export const SCOPED_METADATA = 'sdcore:scoped';
/** Metadata key set on the class listing all scoped property names. */
export const SCOPED_COLUMNS = 'sdcore:scoped-columns';
/** Metadata key set on the class with required/optional scope descriptors. */
export const SCOPED_COLUMN_METADATA = 'sdcore:scoped-column-metadata';

/** Configuration for a tenancy-scoped entity property. */
export interface ScopedOptions {
  /** Required scopes fail closed when their current value is nullish. Defaults to `true`. */
  required?: boolean;
}

/** Runtime metadata recorded for a property decorated with {@link Scoped}. */
export interface ScopedColumnMetadata {
  propertyName: string;
  required: boolean;
}

/**
 * Marks a column as scope-enforced. `BaseRepository` reads the metadata at runtime — with
 * `ITenancyStrategy` registered, every read injects a filter (scalar → `EQUAL`, array → `IN`) and
 * every create auto-fills the column from `getCurrentScope()`. A validated `TenancyBypassGrant`
 * is the only supported way to skip scoping.
 *
 * The column name is the decorated property name — the library never hardcodes one. Use it for any
 * scope dimension (tenant, department, org, project, …).
 *
 * @example
 * @Entity()
 * class Product extends WithAudit(BaseEntity) {
 *   @Column() @Scoped() tenantCode!: string;
 *   @Column({ nullable: true }) @Scoped({ required: false }) departmentCode?: string;
 * }
 */
export function Scoped(options: ScopedOptions = {}): PropertyDecorator {
  return (target, propertyKey) => {
    Reflect.defineMetadata(SCOPED_METADATA, true, target, propertyKey);
    const ctor = target.constructor;
    const propertyName = propertyKey as string;
    const existing: string[] = Reflect.getOwnMetadata(SCOPED_COLUMNS, ctor) ?? [];
    if (!existing.includes(propertyName)) {
      Reflect.defineMetadata(SCOPED_COLUMNS, [...existing, propertyName], ctor);
    }

    const descriptors: ScopedColumnMetadata[] = Reflect.getOwnMetadata(SCOPED_COLUMN_METADATA, ctor) ?? [];
    const required = options.required !== false;
    const prior = descriptors.find((item) => item.propertyName === propertyName);
    const next = prior
      ? descriptors.map((item) => (item.propertyName === propertyName ? { ...item, required: item.required || required } : item))
      : [...descriptors, { propertyName, required }];
    Reflect.defineMetadata(SCOPED_COLUMN_METADATA, next, ctor);
  };
}

/**
 * Returns all property names on `ctor` (and its prototype chain) marked with `@Scoped()`.
 * Returns `[]` if none — `BaseRepository` treats this as "scoping disabled for this entity".
 */
export function getScopedColumns(ctor: ClassRef): string[] {
  return getScopedColumnMetadata(ctor).map((item) => item.propertyName);
}

/** Returns inherited scope descriptors, with a subclass descriptor taking precedence. */
export function getScopedColumnMetadata(ctor: ClassRef): ScopedColumnMetadata[] {
  const seen = new Set<string>();
  const out: ScopedColumnMetadata[] = [];
  let current: ClassRef | null = ctor;
  while (current && (current as object) !== Object.prototype) {
    const own: ScopedColumnMetadata[] = Reflect.getOwnMetadata(SCOPED_COLUMN_METADATA, current) ?? [];
    const legacy: string[] = Reflect.getOwnMetadata(SCOPED_COLUMNS, current) ?? [];
    const descriptors = own.length ? own : legacy.map((propertyName) => ({ propertyName, required: true }));
    for (const descriptor of descriptors) {
      if (seen.has(descriptor.propertyName)) continue;
      seen.add(descriptor.propertyName);
      out.push(descriptor);
    }
    current = Object.getPrototypeOf(current);
  }
  return out;
}
