# Hàng đợi BullMQ {#bullmq-queue}

Tầng queue bọc `@nestjs/bullmq` với một kết nối Redis, các giá trị mặc định nhất quán, public
decorator/type re-export và một lớp worker cơ sở giữ nguyên hành vi retry.

## Mở kết nối một lần {#open-the-connection-once}

```ts
import { Module } from '@nestjs/common';
import { QueueModule } from '@sdcorejs/nestjs/queue';

@Module({
  imports: [
    QueueModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST ?? 'localhost',
        port: Number(process.env.REDIS_PORT ?? 6379),
        db: 1,
      },
      prefix: 'orders:prod:queue',
    }),
  ],
})
export class AppModule {}
```

Thay vào đó, bạn có thể đặt `queue: { connection, prefix, defaultJobOptions }` trong
`SdCoreModule.forRoot()`. Dùng một cách thiết lập root, không dùng cả hai. Tách queue sang cơ sở dữ liệu Redis
hoặc prefix khác với dữ liệu cache.

## Đăng ký và tạo job {#register-and-produce}

```ts
import { Injectable, Module } from '@nestjs/common';
import {
  InjectQueue,
  QueueModule,
  type Queue,
} from '@sdcorejs/nestjs/queue';

interface EmailJob {
  userId: string;
  template: 'welcome' | 'receipt';
}

@Injectable()
class EmailProducer {
  constructor(@InjectQueue('emails') private readonly queue: Queue<EmailJob>) {}

  enqueue(payload: EmailJob) {
    return this.queue.add('send', payload, {
      jobId: `email-${payload.template}-${payload.userId}`,
    });
  }
}

@Module({
  imports: [QueueModule.registerQueue('emails')],
  providers: [EmailProducer],
  exports: [EmailProducer],
})
export class EmailQueueModule {}
```

`jobId` là lựa chọn khử trùng lặp của ứng dụng. Chọn danh tính khớp với ngữ nghĩa nghiệp vụ;
bỏ qua nó sẽ cho phép job lặp lại. BullMQ từ chối custom ID chứa `:`, vì vậy hãy dùng delimiter an toàn
hoặc hash ổn định.

## Tiêu thụ và retry {#consume-and-retry}

```ts
import { Injectable } from '@nestjs/common';
import {
  OnWorkerEvent,
  Processor,
  SdWorkerHost,
  type Job,
} from '@sdcorejs/nestjs/queue';

@Injectable()
class Mailer {
  async send(_userId: string, _template: string): Promise<void> {}
}

@Processor('emails', { concurrency: 5 })
class EmailWorker extends SdWorkerHost<EmailJob, void> {
  constructor(private readonly mailer: Mailer) {
    super();
  }

  async handle(job: Job<EmailJob>): Promise<void> {
    await this.mailer.send(job.data.userId, job.data.template);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<EmailJob> | undefined, error: Error): void {
    this.logger.warn('email attempt failed: ' + (job?.id ?? 'unknown') + ': ' + error.message);
  }
}
```

Đăng ký `EmailWorker` và `Mailer` làm provider trong một module import
`QueueModule.registerQueue('emails')`. Ném lỗi từ `handle()` để đánh dấu một lần thử thất bại.
`SdWorkerHost.process()` ném lại lỗi để BullMQ áp dụng retry; nuốt lỗi sẽ đánh dấu thành công.

## Giá trị mặc định {#defaults}

`DEFAULT_JOB_OPTIONS` cung cấp 3 lần thử, exponential backoff bắt đầu từ 1 giây, 1.000 job hoàn thành
gần nhất và 5.000 job thất bại gần nhất. Override ở root hoặc theo từng `queue.add()`.
Giữ giới hạn lưu trữ để ngăn Redis tăng trưởng không giới hạn.

## Queue và job scheduler {#queue-versus-job-scheduler}

| Nhu cầu | Sử dụng |
| --- | --- |
| payload bền vững, retry, delay, worker pool | hàng đợi BullMQ |
| một bên thắng cho cùng cron tick giữa các API instance | job scheduler |
| cả hai | callback scheduler enqueue một job BullMQ có danh tính idempotent |

Không primitive nào biến side effect bên ngoài tùy ý thành exactly-once. Hãy dùng tính idempotent cấp nghiệp vụ tại
ranh giới tạo side effect.

## Vận hành {#operations}

- Theo dõi job waiting, active, delayed, failed và stalled.
- Cấu hình tính bền vững/khả dụng của Redis theo mức độ bền vững cần thiết.
- Viết handler có tính idempotent vì retry có thể lặp lại công việc.
- Đặt concurrency theo giới hạn downstream, không chỉ theo CPU.
- Cảnh báo khi hết retry và độ trễ tăng.
- Dùng worker/process riêng khi job dài không nên dùng chung tài nguyên API.
