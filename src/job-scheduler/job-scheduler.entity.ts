import { Column, CreateDateColumn, Entity, Generated, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { JobSchedulerStatus, JobSchedulerType } from './types';

/**
 * Distributed cron-lock row. The UNIQUE `lockKey` is the lock: concurrent nodes racing the same
 * scheduled run all try to insert the same `lockKey`; the DB lets exactly one succeed (the winner
 * runs the job), the rest hit a conflict and skip. Register this entity in the consumer datasource.
 */
@Entity('job-scheduler')
@Index(['code'])
export class JobScheduler {
  @PrimaryColumn({ type: 'uuid' })
  @Generated('uuid')
  id!: string;

  /** Atomic lock key: `code` (INITIAL) or `code:runKey` (SCHEDULE). Unique → enforces single-winner. */
  @Column({ type: 'varchar', length: 320, update: false, unique: true })
  lockKey!: string;

  @Column({ type: 'varchar', length: 64, update: false })
  code!: string;

  @Column({ type: 'varchar', length: 256, update: false, nullable: true })
  name!: string;

  @Column({ type: 'enum', enum: JobSchedulerType, update: false })
  type!: JobSchedulerType;

  @Column({ type: 'enum', enum: JobSchedulerStatus })
  status!: JobSchedulerStatus;

  @Column({ type: 'jsonb', nullable: true })
  data!: Record<string, unknown> | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  modifiedAt!: Date;
}
