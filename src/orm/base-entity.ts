import { Generated, PrimaryColumn, BaseEntity as TypeOrmBaseEntity } from 'typeorm';

/**
 * Minimal base entity — only an auto-generated UUID `id`.
 *
 * Audit/timestamp columns are opt-in via mixins:
 * - `WithTimestamps(BaseEntity)` adds `createdAt`, `updatedAt`, `deletedAt`
 * - `WithAudit(BaseEntity)` adds timestamps + `createdBy`, `modifiedBy`, `creator`, `modifier`
 *
 * Tenancy columns are opt-in via the `@TenantScoped()` property decorator.
 *
 * @example
 * @Entity()
 * class Product extends WithAudit(BaseEntity) {
 *   @Column() name!: string;
 * }
 */
export abstract class BaseEntity extends TypeOrmBaseEntity {
  @PrimaryColumn({ type: 'uuid' })
  @Generated('uuid')
  id!: string;
}
