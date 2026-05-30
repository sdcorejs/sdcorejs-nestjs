import { Column, CreateDateColumn, DeleteDateColumn, Entity, Generated, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/** Tracks uploaded files for usage/cleanup. Consumers register this entity in their datasource. */
@Entity('uploaded-file')
export class UploadedFile {
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

  @Column({ default: false, nullable: true })
  isUsed!: boolean;

  @Column({ type: 'varchar', length: 64, nullable: true })
  entity!: string;

  @Column({ type: 'uuid', nullable: true })
  entityId!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  modifiedAt!: Date;

  @DeleteDateColumn()
  deletedAt!: Date;
}
