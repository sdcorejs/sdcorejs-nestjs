import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { OutboxMessage } from './outbox.entity';

export interface OutboxEvent<TPayload extends Record<string, unknown>> {
  topic: string;
  payload: TPayload;
}

/**
 * Consumer-owned idempotency boundary. A production publisher reads unsent rows, publishes them to
 * its broker, and marks `publishedAt`; the unique key prevents a reclaimed job lease from enqueuing
 * the same logical effect twice.
 */
export abstract class TransactionalOutbox {
  abstract enqueueOnce<TPayload extends Record<string, unknown>>(idempotencyKey: string, event: OutboxEvent<TPayload>): Promise<boolean>;
}

@Injectable()
export class PostgresTransactionalOutbox extends TransactionalOutbox {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {
    super();
  }

  async enqueueOnce<TPayload extends Record<string, unknown>>(idempotencyKey: string, event: OutboxEvent<TPayload>): Promise<boolean> {
    const result = await this.dataSource
      .createQueryBuilder()
      .insert()
      .into(OutboxMessage)
      .values({
        idempotencyKey,
        topic: event.topic,
        // TypeORM's recursive QueryDeepPartial type cannot represent an open JSON object even
        // though PostgreSQL's jsonb driver accepts it directly.
        payload: event.payload as never,
        publishedAt: null,
      })
      .orIgnore()
      .returning(['id'])
      .execute();

    return Array.isArray(result.raw) && result.raw.length === 1;
  }
}
