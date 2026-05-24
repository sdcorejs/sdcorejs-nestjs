import { CreateDateColumn, DeleteDateColumn, UpdateDateColumn } from 'typeorm';

/** Constructor type used by mixin factories. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Constructor<T = object> = new (...args: any[]) => T;

/**
 * Mixin that adds `createdAt`, `updatedAt`, `deletedAt` columns managed by TypeORM.
 * No strategy required — values are populated by the database / TypeORM lifecycle.
 *
 * @example
 * class Tag extends WithTimestamps(BaseEntity) {}
 */
export function WithTimestamps<TBase extends Constructor>(Base: TBase) {
  abstract class Timestamped extends Base {
    @CreateDateColumn({ update: false })
    createdAt!: Date;

    @UpdateDateColumn()
    updatedAt!: Date;

    @DeleteDateColumn()
    deletedAt?: Date | null;
  }
  return Timestamped;
}
