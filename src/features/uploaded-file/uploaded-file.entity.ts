import { Column, CreateDateColumn, DeleteDateColumn, Entity, Generated, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import type { UploadedFileDisposition, UploadedFileStatus, UploadedFileVisibility } from './types';

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
@Index('IDX_uploaded_file_pending_cleanup', ['status', 'uploadExpiredAt'])
@Index('IDX_uploaded_file_temporary_cleanup', ['isTemporary', 'status', 'expiredAt'])
@Index('IDX_uploaded_file_tenant_owner_status', ['tenantCode', 'departmentCode', 'userId', 'status'])
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

  /** Exact byte count. Legacy rows may remain null until reconciled from storage. */
  @Column({ type: 'integer', nullable: true, update: false })
  sizeBytes!: number | null;

  /** Storage-declared media type. Legacy rows fall back to extension inference. */
  @Column({ type: 'varchar', length: 255, nullable: true, update: false })
  contentType!: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true, update: false })
  fileExtension!: string;

  @Column({ type: 'varchar', length: 1024, unique: true, update: false })
  key!: string;

  /** Private staging object used by the direct-upload data plane. Never exposed over HTTP. */
  @Column({ type: 'varchar', length: 1024, nullable: true })
  pendingKey!: string | null;

  @Column({ type: 'varchar', length: 1024, unique: true, update: false })
  cdn!: string;

  @Column({ type: 'uuid', update: false })
  userId!: string;

  @Column({ type: 'boolean', default: false, nullable: true })
  isUsed!: boolean;

  @Column({ type: 'varchar', length: 16, default: 'private' })
  visibility!: UploadedFileVisibility;

  /** Existing rows backfill to ready; new direct uploads begin pending. */
  @Column({ type: 'varchar', length: 16, default: 'ready' })
  status!: UploadedFileStatus;

  @Column({ type: 'boolean', default: false })
  isTemporary!: boolean;

  /** Expiry of the pending PUT authorization, distinct from temporary-file expiry. */
  @Column({ type: 'timestamptz', nullable: true })
  uploadExpiredAt!: Date | null;

  /** Exactly completedAt + 24 hours for temporary files; null for permanent files. */
  @Column({ type: 'timestamptz', nullable: true })
  expiredAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @Column({ type: 'varchar', length: 16, default: 'attachment' })
  disposition!: UploadedFileDisposition;

  @Column({ type: 'varchar', length: 128, nullable: true })
  checksum!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  etag!: string | null;

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
