# Job đã lên lịch với outbox {#scheduled-jobs-with-an-outbox}

Database lease ngăn hai node đang hoạt động sở hữu cùng một tick, nhưng không thể khiến hiệu ứng bên
ngoài trở thành exactly-once. Công thức này kết hợp `lease.idempotencyKey`, một hàng outbox duy nhất
và idempotency header ở downstream.

## Entity outbox {#outbox-entity}

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

Tạo migration PostgreSQL cho entity thuộc về ứng dụng này. Khóa idempotency duy nhất khiến việc
enqueue lại sau khi lease được reclaim trở thành no-op.

## Enqueue một lần trong lease {#enqueue-once-under-the-lease}

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

Mọi node đều suy ra cùng ngày UTC cho cùng tick 02:00. Nếu stale lease được reclaim, owner mới nhận
cùng `idempotencyKey`, vì vậy unique insert không tạo event logic thứ hai. Các thay đổi cơ sở dữ liệu
domain có thể được commit trong cùng `dataSource.transaction()`.

## Dispatch với deduplication ở downstream {#dispatch-with-downstream-deduplication}

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

Chỉ cấu hình billing origin trong `http.trustedOrigins` nếu origin đó được phép nhận danh tính đã
truyền. Endpoint downstream phải lưu và deduplicate `Idempotency-Key`. Nếu worker gặp sự cố sau HTTP
call nhưng trước `sentAt`, lần retry sẽ gửi cùng key và downstream trả kết quả ban đầu thay vì lặp
lại hiệu ứng.

Để có throughput cao hơn, hãy thêm cơ chế claim hàng cơ sở dữ liệu (`FOR UPDATE SKIP LOCKED` hoặc
pattern ứng dụng tương đương) để nhiều dispatcher không đồng thời xử lý cùng hàng pending. Claiming
policy đó là mã ứng dụng, không thuộc `JobSchedulerService`.

## Assertion {#assertions}

- `{ type, code, runKey }` giống nhau tạo ra `idempotencyKey` giống nhau;
- lease được reclaim sẽ xoay vòng `ownerToken` nhưng giữ nguyên `idempotencyKey`;
- run key khác nhau tạo các hàng outbox khác nhau;
- insert outbox trùng lặp bị bỏ qua; và
- dispatch lặp lại được service downstream deduplicate.
