import { Column, CreateDateColumn, DeleteDateColumn, Entity, Generated, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * Tracks uploaded files for usage/cleanup. Table `uploaded_file`; lives in the consumer's default
 * schema (the consumer sets it via their TypeORM datasource — this lib stays schema-agnostic).
 * Consumers register this entity in their datasource (or use `autoLoadEntities`).
 *
 * `TExtraData` types the `extraData` jsonb bag for consumer-defined metadata — purely compile-time
 * (the column is always `jsonb`; the generic just shapes reads/writes). Reference it as
 * `UploadedFile<MyExtra>` in your own code; the lib's repository/service default to a loose record.
 */
@Entity('uploaded_file')
@Index('IDX_uploaded_file_tenant_owner_lookup', ['tenantCode', 'departmentCode', 'userId', 'id'])
@Index('IDX_uploaded_file_upload_pending', ['uploadPendingAt'])
@Index('IDX_uploaded_file_deletion_pending', ['deletionPendingAt'])
export class UploadedFile<TExtraData = Record<string, unknown>> {
  @PrimaryColumn({ type: 'uuid' })
  @Generated('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64 })
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

  @Column({ type: 'uuid', update: false })
  userId!: string;

  @Column({ type: 'boolean', default: false, nullable: true })
  isUsed!: boolean;

  /** Durable upload-activation lease. Maintenance retains this tombstone until the writer settles. */
  @Column({ type: 'timestamptz', nullable: true })
  uploadPendingAt!: Date | null;

  /** Durable storage-deletion outbox marker. Active reads exclude rows once this is set. */
  @Column({ type: 'timestamptz', nullable: true })
  deletionPendingAt!: Date | null;

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

  /** Consumer-defined extra metadata (jsonb). Shape is typed by `TExtraData`; optional. */
  @Column({ type: 'jsonb', nullable: true })
  extraData?: Partial<TExtraData>;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  modifiedAt!: Date;

  @DeleteDateColumn()
  deletedAt!: Date;
}
