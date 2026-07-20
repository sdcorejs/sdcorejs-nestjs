# API queue BullMQ {#bullmq-queue-api}

Đường dẫn import: `@sdcorejs/nestjs/queue`

Package queue bọc việc đăng ký root/feature của `@nestjs/bullmq`, áp dụng mặc định retry/retention
có giới hạn và cung cấp lớp worker cơ sở duy trì đúng ngữ nghĩa retry của BullMQ.

## Các export {#exports}

| Export | Loại | Mục đích |
| --- | --- | --- |
| `QueueConnectionConfig` | interface | Option kết nối Redis/ioredis |
| `QueueModuleConfig` | interface | Kết nối, prefix và option mặc định của job |
| `DEFAULT_JOB_OPTIONS` | value | Các mặc định retry/backoff/retention được phát hành |
| `DEFAULT_QUEUE_PREFIX` | value | `'sdcore:queue'` |
| `QueueModule` | class | `forRoot(config)` và `registerQueue(...names)` |
| `SdWorkerHost<TData, TResult>` | abstract class | Worker có logging với `handle(job)` abstract |
| `Processor`, `InjectQueue`, `OnWorkerEvent`, `OnQueueEvent` | decorator | Re-export từ `@nestjs/bullmq` |
| `Job`, `Queue`, `Worker`, `JobsOptions` | type | Re-export chỉ kiểu của các primitive BullMQ |

Các re-export bên thứ ba cho phép consumer queue dùng một đường dẫn import; hành vi và API rộng hơn
của chúng vẫn do BullMQ và `@nestjs/bullmq` định nghĩa.

## Đăng ký root và feature {#root-and-feature-registration}

```ts
@Module({
  imports: [
    QueueModule.forRoot({
      connection: {
        host: 'redis.internal.example',
        port: 6379,
        db: 3,
      },
      prefix: 'orders:queue',
      defaultJobOptions: {
        attempts: 5,
      },
    }),
  ],
})
export class AppModule {}
```

Chỉ gọi `forRoot` một lần. Trong mỗi feature tạo hoặc tiêu thụ queue có tên:

```ts
@Module({
  imports: [QueueModule.registerQueue('emails', 'exports')],
  providers: [EmailsWorker, EmailProducer],
})
export class EmailModule {}
```

`defaultJobOptions` của root được merge đè lên các mặc định sau:

```ts
{
  attempts: 3,
  backoff: { type: 'exponential', delay: 1000 },
  removeOnComplete: 1000,
  removeOnFail: 5000,
}
```

Prefix queue mặc định là `sdcore:queue`. Dùng prefix riêng biệt cho từng ứng dụng/môi trường và nên
dùng Redis DB tách khỏi cache thông thường.

## Producer {#producer}

```ts
@Injectable()
export class EmailProducer {
  constructor(@InjectQueue('emails') private readonly queue: Queue) {}

  enqueueWelcome(userId: string) {
    return this.queue.add(
      'welcome',
      { userId },
      {
        jobId: `welcome-${userId}`,
        delay: 5_000,
      },
    );
  }
}
```

Option theo từng job ghi đè option root theo hành vi BullMQ. Job ID BullMQ tùy chỉnh không được chứa
`:`; hãy dùng dấu phân cách an toàn hoặc hash ổn định của danh tính nghiệp vụ nhiều phần.

## Worker {#worker}

```ts
@Processor('emails', { concurrency: 5 })
export class EmailsWorker extends SdWorkerHost<{ userId: string }, void> {
  constructor(private readonly mailer: Mailer) {
    super();
  }

  async handle(job: Job<{ userId: string }>): Promise<void> {
    await this.mailer.sendWelcome(job.data.userId);
  }
}
```

Override `handle`, không phải `process`. `SdWorkerHost.process` log queue/name/id và lần thử, sau đó
ném lại lỗi để BullMQ ghi nhận lần thử và áp dụng retry/backoff. Việc nuốt lỗi trong `handle` báo cáo
thành công và vô hiệu hóa retry cho lỗi đó.

## Lưu ý vận hành và bảo mật {#operational-and-security-notes}

- Redis lưu payload, kết quả job và chi tiết lỗi. Không enqueue secret hoặc access token thô; hãy
  gửi định danh và tải lại dữ liệu đã được cấp quyền trong worker.
- Job thường có ngữ nghĩa at-least-once. Dùng giá trị `jobId` ổn định và cơ chế
  idempotency/outbox của ứng dụng cho các side effect bên ngoài.
- Giới hạn kích thước payload, concurrency và retention phù hợp workload. Các số lượng retention
  được phát hành chỉ là mặc định, không phải hoạch định capacity.
- Worker queue không kế thừa HTTP `AsyncLocalStorage`. Đưa định danh tenant/user rõ ràng vào
  payload job đã validation và thiết lập execution context tin cậy trong worker.
- `QueueModule` khác với [job scheduler](./features/job-scheduler.md) PostgreSQL: BullMQ vận chuyển
  công việc; scheduler điều phối một lần chạy logic trên nhiều node.
