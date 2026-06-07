import 'reflect-metadata';
import type { ClassRef } from '../types/class-ref.types';

export const SCHEMA_METADATA = 'sdcore:schema';
export const SCHEMA_PROP_METADATA = 'sdcore:schema:prop';

export interface SchemaOptions {
  name?: string;
  description?: string;
  [key: string]: unknown;
}

export interface SchemaPropOptions {
  label?: string;
  description?: string;
  type?: string;
  required?: boolean;
  unique?: boolean;
  default?: unknown;
  [key: string]: unknown;
}

/**
 * Class-level schema descriptor consumed by `BaseService.schema()`. Provides UI-facing
 * metadata (display name, description) and arbitrary domain extensions.
 *
 * @example
 * @Schema({ name: 'Product', description: 'Sản phẩm bán hàng' })
 * @Entity()
 * class Product extends WithAudit(BaseEntity) {}
 */
export function Schema(options: SchemaOptions = {}): ClassDecorator {
  return (target) => {
    Reflect.defineMetadata(SCHEMA_METADATA, options, target);
  };
}

/**
 * Property-level schema descriptor (label, validation hints, default value).
 * Accumulates into a `Record<propertyName, SchemaPropOptions>` on the class.
 *
 * @example
 * class Product {
 *   @SchemaProp({ label: 'Mã sản phẩm', required: true, unique: true })
 *   code!: string;
 * }
 */
export function SchemaProp(options: SchemaPropOptions = {}): PropertyDecorator {
  return (target, propertyKey) => {
    const ctor = target.constructor;
    const existing: Record<string, SchemaPropOptions> = Reflect.getOwnMetadata(SCHEMA_PROP_METADATA, ctor) ?? {};
    Reflect.defineMetadata(SCHEMA_PROP_METADATA, { ...existing, [propertyKey as string]: options }, ctor);
  };
}

export function getSchema(ctor: ClassRef): SchemaOptions {
  return Reflect.getMetadata(SCHEMA_METADATA, ctor) ?? {};
}

export function getSchemaProps(ctor: ClassRef): Record<string, SchemaPropOptions> {
  const seen: Record<string, SchemaPropOptions> = {};
  let current: ClassRef | null = ctor;
  while (current && (current as object) !== Object.prototype) {
    const own: Record<string, SchemaPropOptions> = Reflect.getOwnMetadata(SCHEMA_PROP_METADATA, current) ?? {};
    for (const [k, v] of Object.entries(own)) {
      if (!(k in seen)) seen[k] = v;
    }
    current = Object.getPrototypeOf(current);
  }
  return seen;
}
