import { Column, CreateDateColumn, Entity, Generated, Index, PrimaryColumn } from 'typeorm';
import { ActionHistoryType } from './types';

/**
 * Standalone audit-trail row (manual action log with before/after snapshots), distinct from the
 * entity-change `AuditSubscriber` in `@sdcorejs/nestjs/audit`. Consumers must register this entity
 * in their TypeORM datasource `entities` array for the repository to resolve.
 */
@Entity('action-history')
export class ActionHistory {
  @PrimaryColumn({ type: 'uuid' })
  @Generated('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64, update: false })
  table!: string;

  @Column({ type: 'uuid', update: false })
  @Index()
  tableId!: string;

  @Column({ type: 'uuid', update: false, nullable: true })
  userId!: string;

  @Column({ type: 'varchar', length: 64, update: false, nullable: true })
  username!: string;

  @Column({ type: 'varchar', length: 256, update: false, nullable: true })
  fullName!: string;

  @Column({ type: 'enum', enum: ActionHistoryType, update: false })
  type!: ActionHistoryType;

  @Column({ type: 'jsonb', update: false, nullable: true })
  fromData!: Record<string, unknown>;

  @Column({ type: 'jsonb', update: false, nullable: true })
  toData!: Record<string, unknown>;

  @Column({ type: 'varchar', length: 1024, nullable: true, update: false })
  note!: string;

  @CreateDateColumn()
  createdAt!: Date;
}
