import 'reflect-metadata';
import { Column } from 'typeorm';
import type { ClassRef } from '../types/class-ref.types';
import type { UserSnapshot } from '../types/user-snapshot.types';
import { WithTimestamps, type Constructor } from './with-timestamps';

/** Metadata key set on classes that opt into audit filling via `WithAudit`. */
export const AUDIT_ENABLED_METADATA = 'sdcore:audit:enabled';

/**
 * Mixin that adds `WithTimestamps` plus `createdBy`, `modifiedBy`, `creator`, `modifier`.
 * Marks the class with metadata `sdcore:audit:enabled = true` so `AuditSubscriber` knows
 * to invoke `IAuditStrategy.onCreate / onUpdate / onSoftDelete` on its instances.
 *
 * @example
 * class Product extends WithAudit(BaseEntity) {}
 */
export function WithAudit<TBase extends Constructor>(Base: TBase) {
  const Timestamped = WithTimestamps(Base);

  abstract class Audited extends Timestamped {
    @Column({ type: 'uuid', nullable: true, update: false })
    createdBy?: string | null;

    @Column({ type: 'uuid', nullable: true })
    modifiedBy?: string | null;

    @Column({ type: 'jsonb', nullable: true, update: false })
    creator?: UserSnapshot | null;

    @Column({ type: 'jsonb', nullable: true })
    modifier?: UserSnapshot | null;
  }

  Reflect.defineMetadata(AUDIT_ENABLED_METADATA, true, Audited);
  return Audited;
}

/**
 * Detects whether `target` (or any class in its prototype chain) was produced by
 * the `WithAudit` mixin. Used by `AuditSubscriber` and `BaseRepository.import`.
 */
export function isAuditEnabled(target: ClassRef | undefined): boolean {
  if (!target) return false;
  return Reflect.getMetadata(AUDIT_ENABLED_METADATA, target) === true;
}
