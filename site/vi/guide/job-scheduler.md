# Job scheduler và tính idempotent {#job-scheduler-and-idempotency}

`JobSchedulerService` là lease phân tán dựa trên PostgreSQL dành cho cron job và job chạy một lần. Khi
mọi instance ứng dụng cạnh tranh cùng một danh tính logic, một claim cơ sở dữ liệu sẽ thắng và các instance còn lại
trả về mà không chạy.

## Bật tính năng {#enable-the-feature}

```ts
import { SdCoreModule } from '@sdcorejs/nestjs';

SdCoreModule.forRoot({
  jobScheduler: {},
});
```

Đăng ký entity `JobScheduler` đã export thông qua `autoLoadEntities: true` hoặc một
danh sách entity TypeORM tường minh và migration. `lockKey` duy nhất của entity là một phần trong bảo đảm đồng thời.

## Cron lặp lại {#recurring-cron}

```ts
import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  JobSchedulerService,
  JobSchedulerType,
} from '@sdcorejs/nestjs/features';

@Injectable()
class OrderSyncJob {
  constructor(private readonly jobs: JobSchedulerService) {}

  @Cron('*/5 * * * *')
  async tick(): Promise<void> {
    const bucketMs = 5 * 60_000;
    const bucketStart = new Date(Math.floor(Date.now() / bucketMs) * bucketMs);
    const runKey = bucketStart.toISOString();

    await this.jobs.runExclusive(
      {
        code: 'sync-orders',
        runKey,
        type: JobSchedulerType.SCHEDULE,
      },
      async (lease) => {
        await this.syncOneTick(lease.idempotencyKey);
      },
    );
  }

  private async syncOneTick(idempotencyKey: string): Promise<void> {
    // Pass this stable logical-run key to an outbox/deduplication boundary.
    process.stdout.write('sync ' + idempotencyKey + '\n');
  }
}
```

Mỗi node phải tạo cùng một `runKey` cho cùng một lần chạy theo lịch. Ưu tiên thời điểm kích hoạt dự kiến
của scheduler khi có sẵn. Fallback ở trên làm tròn thời gian đồng hồ xuống một bucket UTC chính xác năm phút;
hãy đồng bộ đồng hồ worker để các node gần ranh giới bucket không tạo kết quả khác nhau.

Khóa ổn định bắt đầu bằng `v2:`. Lưu giá trị thô đó trong outbox/payload, nhưng không truyền trực tiếp
làm `jobId` tùy chỉnh của BullMQ vì BullMQ từ chối `:`. Tạo một hash base64url/hex xác định,
không chứa dấu hai chấm khi queue cũng cần ID khử trùng lặp.

## Chạy một lần {#run-once}

```ts
await jobs.runExclusive(
  {
    code: 'seed-default-settings',
    type: JobSchedulerType.INITIAL,
  },
  async ({ idempotencyKey }) => seedDefaults(idempotencyKey),
);
```

Đoạn mã tập trung này giả định đã inject `jobs` và có hàm ứng dụng `seedDefaults`. `INITIAL`
cấm `runKey`; hàng thành công vẫn bị khóa vĩnh viễn. `SCHEDULE` yêu cầu một
`runKey` không trống. Các giá trị danh tính được trim và mã hóa thành khóa SHA-256 có phiên bản.

## Hành vi lease {#lease-behavior}

1. Claim mới sử dụng `INSERT ... ON CONFLICT DO NOTHING RETURNING id`.
2. Hàng `SUCCESS` xung đột hoặc `RUNNING` còn hiệu lực không được acquire.
3. Hàng `FAIL` hoặc `RUNNING` đã hết hạn có thể được claim lại một cách nguyên tử.
4. Mỗi claim luân chuyển `ownerToken`; worker cũ không thể heartbeat/finalize hàng đã được claim lại.
5. `runExclusive` thực hiện heartbeat, chạy callback và ghi lại thành công/thất bại cho owner hiện tại.

Callback nhận:

```ts
interface JobExecutionLease {
  id: string;
  ownerToken: string;
  idempotencyKey: string;
}
```

`idempotencyKey` ổn định cho lần thực thi logic `{ type, code, runKey }`, kể cả sau khi
lease được claim lại. `ownerToken` cố ý không ổn định và chỉ là capability rào lease.
Không dùng ID hàng cơ sở dữ liệu hoặc owner token làm khóa khử trùng lặp bên ngoài.

## Thời gian {#timing}

| Tùy chọn | Mặc định | Quy tắc |
| --- | --- | --- |
| `leaseMs` | 15 phút | số nguyên an toàn lớn hơn 2 |
| `heartbeatMs` | min(60 giây, lease/3) | 0 hoặc số nguyên an toàn nhỏ hơn lease/2 |

Đặt lease cao hơn độ trễ thực tế và heartbeat thấp hơn một nửa lease một khoảng an toàn:

```ts
await jobs.runExclusive(
  {
    code: 'nightly-import',
    runKey: new Date().toISOString().slice(0, 10),
    type: JobSchedulerType.SCHEDULE,
    leaseMs: 2 * 60 * 60 * 1_000,
    heartbeatMs: 30_000,
  },
  async ({ idempotencyKey }) => importNightly(idempotencyKey),
);
```

Đoạn mã tập trung này giả định có `jobs`, `JobSchedulerType` và hàm ứng dụng
`importNightly`. Chỉ đặt `heartbeatMs: 0` cho công việc được bảo đảm hoàn thành sớm hơn nhiều so với lease.

## Không phải exactly-once {#not-exactly-once}

Worker có thể tạo side effect bên ngoài, mất lease và thất bại trước khi ghi nhận thành công. Worker khác
sau đó có thể claim lại cùng lần chạy logic. Vì vậy, rào bằng cơ sở dữ liệu không làm side effect bên ngoài
trở thành exactly-once.

Dùng `lease.idempotencyKey` làm khóa duy nhất trong một trong các ranh giới do ứng dụng sở hữu sau:

- hàng transactional outbox được commit cùng thay đổi cơ sở dữ liệu;
- bảng inbox/khử trùng lặp ở consumer;
- header idempotency được API downstream hỗ trợ; hoặc
- bản ghi thao tác nghiệp vụ duy nhất.

Xem [Ví dụ job theo lịch](/vi/examples/scheduled-jobs) để biết workflow theo cấu trúc outbox.

## API lease thủ công {#manual-lease-api}

`acquire()` trả về `{ acquired: false }` cho bên thua hoặc
`{ acquired: true, id, ownerToken, idempotencyKey }` cho bên thắng. Caller thủ công có thể dùng
`heartbeat()`, `complete()`, `fail()` và `release()` với `{ id, ownerToken }`.
`release()` đánh dấu hàng là thất bại để lần acquire sau có thể retry. Ưu tiên `runExclusive()` trừ khi bạn
cần kiểm soát lifecycle tường minh, và luôn finalize trong các error path.
