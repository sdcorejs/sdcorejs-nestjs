import { Column, CreateDateColumn, DeleteDateColumn, Entity, Generated, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * Tracks uploaded files for usage/cleanup. Table `file`; lives in the consumer's default schema
 * (the consumer sets it via their TypeORM datasource — this lib stays schema-agnostic). Consumers
 * register this entity in their datasource (or use `autoLoadEntities`).
 */
@Entity('file')
export class FileEntity {
  @PrimaryColumn({ type: 'uuid' })
  @Generated('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  tenantCode!: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  departmentCode!: string;

  @Column({ type: 'varchar', length: 1024, update: false })
  fileName!: string;

  @Column({ type: 'float8', nullable: true, update: false })
  fileSize!: number;

  @Column({ type: 'varchar', length: 16, nullable: true, update: false })
  fileExtension!: string;

  @Column({ type: 'varchar', length: 1024, unique: true, update: false })
  key!: string;

  @Column({ type: 'varchar', length: 1024, unique: true, update: false })
  cdn!: string;

  @Column({ type: 'uuid', nullable: true, update: false })
  userId!: string;

  @Column({ type: 'boolean', default: false, nullable: true })
  isUsed!: boolean;

  /** Owning module (e.g. `masterdata`). */
  @Column({ type: 'varchar', length: 64, nullable: true })
  @Index()
  module!: string;

  /** Owning entity name (e.g. `brand`). */
  @Column({ type: 'varchar', length: 64, nullable: true })
  entity!: string;

  /** Owning entity row id. */
  @Column({ type: 'uuid', nullable: true })
  entityId!: string;

  /** Field/type role on the owner (e.g. `logo`, `avatar`, `attachment`). */
  @Column({ type: 'varchar', length: 64, nullable: true })
  type!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  modifiedAt!: Date;

  @DeleteDateColumn()
  deletedAt!: Date;
}
