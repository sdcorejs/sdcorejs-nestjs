import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('outbox_message')
@Index('UX_outbox_message_idempotency_key', ['idempotencyKey'], { unique: true })
export class OutboxMessage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 128, update: false })
  idempotencyKey!: string;

  @Column({ type: 'varchar', length: 128, update: false })
  topic!: string;

  @Column({ type: 'jsonb', update: false })
  payload!: Record<string, unknown>;

  @Column({ type: 'timestamptz', nullable: true })
  publishedAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;
}
