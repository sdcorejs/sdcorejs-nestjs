# Scheduled jobs with an outbox

A database lease prevents two live nodes from owning the same tick, but it cannot make an external
effect exactly-once. This recipe combines `lease.idempotencyKey`, a unique outbox row, and a
downstream idempotency header.

## Outbox entity

```ts
import {
  Column,
  CreateDateColumn,
  Entity,
  Generated,
  PrimaryColumn,
} from 'typeorm';

@Entity('outbox_event')
export class OutboxEvent {
  @PrimaryColumn({ type: 'uuid' })
  @Generated('uuid')
  id!: string;

  @Column({ length: 320, unique: true })
  idempotencyKey!: string;

  @Column({ length: 128 })
  topic!: string;

  @Column({ type: 'jsonb' })
  payload!: Record<string, unknown>;

  @Column({ type: 'timestamptz', nullable: true })
  sentAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;
}
```

Generate a PostgreSQL migration for this application-owned entity. The unique idempotency key makes
re-enqueue after lease reclamation a no-op.

## Enqueue once under the lease

```ts
import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DataSource, type EntityManager } from 'typeorm';
import {
  JobSchedulerService,
  JobSchedulerType,
} from '@sdcorejs/nestjs/features';

@Injectable()
class OutboxWriter {
  async enqueueOnce(
    manager: EntityManager,
    event: Pick<OutboxEvent, 'idempotencyKey' | 'topic' | 'payload'>,
  ): Promise<boolean> {
    const result = await manager
      .createQueryBuilder()
      .insert()
      .into(OutboxEvent)
      .values({ ...event, sentAt: null })
      .orIgnore()
      .returning(['id'])
      .execute();
    return Array.isArray(result.raw) && result.raw.length === 1;
  }
}

@Injectable()
class DailyBillingJob {
  constructor(
    private readonly jobs: JobSchedulerService,
    private readonly dataSource: DataSource,
    private readonly outbox: OutboxWriter,
  ) {}

  @Cron('0 2 * * *', { timeZone: 'UTC' })
  async tick(): Promise<void> {
    const runKey = new Date().toISOString().slice(0, 10);

    await this.jobs.runExclusive(
      {
        code: 'daily-billing',
        runKey,
        type: JobSchedulerType.SCHEDULE,
      },
      ({ idempotencyKey }) =>
        this.dataSource.transaction((manager) =>
          this.outbox.enqueueOnce(manager, {
            idempotencyKey,
            topic: 'billing.daily',
            payload: { billingDate: runKey },
          }),
        ),
    );
  }
}
```

Every node derives the same UTC date for the same 02:00 tick. If a stale lease is reclaimed, the new
owner receives the same `idempotencyKey`, so the unique insert does not create a second logical
event. Domain database changes can be committed in the same `dataSource.transaction()`.

## Dispatch with downstream deduplication

```ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, type Repository } from 'typeorm';
import { HttpService } from '@sdcorejs/nestjs/services';

@Injectable()
class OutboxDispatcher {
  constructor(
    @InjectRepository(OutboxEvent)
    private readonly repository: Repository<OutboxEvent>,
    private readonly http: HttpService,
  ) {}

  async dispatch(limit = 100): Promise<number> {
    const rows = await this.repository.find({
      where: { sentAt: IsNull() },
      order: { createdAt: 'ASC' },
      take: Math.max(1, Math.min(limit, 100)),
    });

    let sent = 0;
    for (const row of rows) {
      await this.http.post('/billing/run', row.payload, {
        headers: { 'Idempotency-Key': row.idempotencyKey },
      });
      const result = await this.repository.update(
        { id: row.id, sentAt: IsNull() },
        { sentAt: new Date() },
      );
      if (result.affected === 1) sent += 1;
    }
    return sent;
  }
}
```

Configure the billing origin in `http.trustedOrigins` only if it should receive propagated
identity. The downstream endpoint must persist and deduplicate `Idempotency-Key`. If this worker
crashes after the HTTP call but before `sentAt`, the retry sends the same key and the downstream
returns the original result instead of repeating the effect.

For higher throughput, add database row claiming (`FOR UPDATE SKIP LOCKED` or an equivalent
application pattern) so multiple dispatchers do not work the same pending row concurrently. That
claiming policy is application code, not part of `JobSchedulerService`.

## Assertions

- identical `{ type, code, runKey }` produces identical `idempotencyKey`;
- a reclaimed lease rotates `ownerToken` but preserves `idempotencyKey`;
- different run keys produce different outbox rows;
- a duplicate outbox insert is ignored; and
- a repeated dispatch is deduplicated by the downstream service.
