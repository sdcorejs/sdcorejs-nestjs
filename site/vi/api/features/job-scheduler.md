# API job scheduler {#job-scheduler-api}

Đường dẫn import: `@sdcorejs/nestjs/features`

Job scheduler là distributed lease dựa trên PostgreSQL. Các node cạnh tranh cho cùng một lần chạy
logic dùng một hàng khóa unique; chỉ node thắng thực thi. Cơ chế này điều phối việc thực thi nhưng
không làm các side effect bên ngoài trở thành exactly-once.

## Các export {#exports}

| Export                                            | Loại                | Mục đích                                                                                |
| ------------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------- |
| `JobScheduler`                                    | entity class        | Hàng lease `job-scheduler`                                                              |
| `JobSchedulerStatus`                              | enum                | `RUNNING`, `SUCCESS`, `FAIL`                                                            |
| `JobSchedulerType`                                | enum                | `INITIAL`, `SCHEDULE`                                                                   |
| `JobAcquireOptions`                               | interface           | Danh tính logic và thời gian lease                                                       |
| `JobAcquireResult`                                | discriminated union | `acquired: true` chứa row/token/idempotency key bắt buộc; `false` không chứa gì         |
| `JobLease`                                        | interface           | Khả năng fencing `{ id, ownerToken }`                                                    |
| `JobExecutionLease`                               | interface           | `JobLease` cùng `idempotencyKey` ổn định bắt buộc                                       |
| `RunExclusiveResult<T>`                           | interface           | `{ acquired, result? }`                                                                 |
| `DEFAULT_LEASE_MS`                                | value               | 15 phút                                                                                 |
| `DEFAULT_HEARTBEAT_MS`                            | value               | Khoảng mặc định tối đa: 60 giây                                                         |
| `LostJobLeaseError`                               | class               | Node thắng mất quyền sở hữu trước khi hoàn tất                                          |
| `InvalidJobLeaseOptionsError`                     | class               | Thời gian lease/heartbeat không an toàn                                                 |
| `InvalidJobIdentityOptionsError`                  | class               | Danh tính code/type/runKey mơ hồ                                                        |
| `JobSchedulerService`                             | class               | API acquire, fence, finalize và chạy callback                                           |
| `JobSchedulerModule`, `JobSchedulerModuleOptions` | class/type          | Đăng ký feature                                                                         |

## Thiết lập entity và module {#entity-and-module-setup}

```ts
TypeOrmModule.forRoot({
  type: 'postgres',
  // ...
  entities: [JobScheduler],
});

JobSchedulerModule.forRoot({ global: true });
```

Thêm entity và áp dụng schema/constraint `lockKey` unique trước khi chạy job. `global` mặc định là
`true`. Triển khai dùng hành vi PostgreSQL `ON CONFLICT DO NOTHING`, `RETURNING`,
`CURRENT_TIMESTAMP`, ép kiểu interval, UUID, enum và JSONB.

## Danh tính job logic {#logical-job-identity}

```ts
interface JobAcquireOptions {
  code: string;
  runKey?: string;
  name?: string;
  type?: JobSchedulerType;
  leaseMs?: number;
  heartbeatMs?: number;
}
```

- `code` được trim và phải chứa 1–64 ký tự.
- Type mặc định là `SCHEDULE`.
- `SCHEDULE` yêu cầu `runKey` không rỗng, dài tối đa 1,024 ký tự. Mọi node phải dùng cùng key cho
  cùng tick, ví dụ `2026-07-20T03:00:00Z`.
- `INITIAL` cấm `runKey`, tạo một khóa run-once chuẩn cho code.
- Validation runtime cũng từ chối giá trị `code`/`runKey` không phải chuỗi và giá trị `type` không
  xác định bằng `InvalidJobIdentityOptionsError` trước khi phát SQL, kể cả lời gọi từ JavaScript
  không có kiểu.
- Bỏ qua trường lease để dùng mặc định; giá trị `null`, không phải số và timing không phải safe
  integer rõ ràng sẽ ném `InvalidJobLeaseOptionsError` thay vì bị coi là bỏ qua.
- Danh tính được encode thành key SHA-256 có version bắt đầu bằng `v2:`. Thành phần thô không được
  lưu trong unique key.

## `runExclusive` {#runexclusive}

```ts
const outcome = await jobs.runExclusive(
  {
    code: 'sync-orders',
    name: 'Sync orders from ERP',
    type: JobSchedulerType.SCHEDULE,
    runKey: tick.toISOString(),
    leaseMs: 15 * 60_000,
  },
  async ({ idempotencyKey }) => {
    return outbox.enqueueOnce({
      idempotencyKey,
      type: 'erp-order-sync',
      payload: { tick: tick.toISOString() },
    });
  },
);

if (!outcome.acquired) return; // another node owns or completed this logical run
```

Signature:

```ts
runExclusive<T>(
  options: JobAcquireOptions,
  fn: (lease: JobExecutionLease) => Promise<T>,
): Promise<RunExclusiveResult<T>>
```

Node thắng nhận `ownerToken` không thể đoán và `idempotencyKey` ổn định. Khi reclaim lease cũ,
owner token được xoay nhưng idempotency key cho lần thực thi logic `{ type, code, runKey }` được giữ
nguyên. Dùng stable key đó trong bản ghi outbox/deduplication nghiệp vụ unique trước khi tạo side
effect bên ngoài.

`idempotencyKey` bắt đầu bằng `v2:`. Giữ giá trị thô cho deduplication outbox/nghiệp vụ; nếu nó cũng
phải trở thành `jobId` BullMQ tùy chỉnh, trước tiên hãy tạo hash xác định không chứa dấu hai chấm vì
BullMQ từ chối `:` trong custom ID.

Khi callback thành công, `runExclusive` đánh dấu lease đang sở hữu là `SUCCESS`. Khi thất bại, nó
đánh dấu `FAIL` và ném lại lỗi. Nếu quyền sở hữu bị reclaim trước khi finalize, nó ném
`LostJobLeaseError`. Owner cũ không thể heartbeat hoặc finalize sau khi token bị xoay.

::: warning Side effect bên ngoài
Database lease có một owner tại mỗi thời điểm, không phải exactly-once. Worker có thể gửi email
hoặc gọi hệ thống khác rồi mất lease trước khi ghi nhận thành công. Luôn làm các effect đó idempotent
bằng `idempotencyKey` và constraint outbox/deduplication unique.
:::

## API lease thủ công {#manual-lease-api}

```ts
const lock = await jobs.acquire(options);
if (!lock.acquired || !lock.id || !lock.ownerToken || !lock.idempotencyKey) return;

const lease = { id: lock.id, ownerToken: lock.ownerToken };
try {
  await work(lock.idempotencyKey);
  if (!(await jobs.complete(lease, { rows: 42 }))) {
    throw new LostJobLeaseError(lock.id);
  }
} catch (error) {
  await jobs.fail(lease, { error: String(error) });
  throw error;
}
```

| Method                   | Hành vi                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------- |
| `acquire(options)`       | Atomic insert mới, nếu không thì reclaim `FAIL` hoặc `RUNNING` hết hạn; `SUCCESS` vẫn bị khóa |
| `heartbeat(lease)`       | Chỉ tăng `modifiedAt` database cho owner `RUNNING` hiện tại                                 |
| `complete(lease, data?)` | Đặt `SUCCESS` và dữ liệu JSON tùy chọn; false nếu mất quyền sở hữu                           |
| `fail(lease, data?)`     | Đặt `FAIL`; false nếu mất quyền sở hữu                                                      |
| `release(lease, data?)`  | Alias của fail, mặc định `{ released: true }`, làm lần acquire kế tiếp đủ điều kiện          |

## Thời gian lease {#lease-timing}

`leaseMs` mặc định là 15 phút và phải là safe integer dương lớn hơn 2. Heartbeat mặc định là giá
trị nhỏ hơn giữa 60 giây và một phần ba lease. `heartbeatMs` rõ ràng phải là safe integer không âm
và, khi khác 0, nhỏ hơn nghiêm ngặt một nửa lease. `0` tắt heartbeat và chỉ an toàn với job được bảo
đảm hoàn thành sớm hơn nhiều so với lease.

`runExclusive` tự động bắt đầu/dừng heartbeat. Caller `acquire` thủ công tự sở hữu việc heartbeat
và finalize.

## Ngữ nghĩa lỗi và retry {#failure-and-retry-semantics}

Hàng `FAIL` có thể được reclaim ngay. Hàng `RUNNING` chỉ có thể được reclaim khi `modifiedAt` trong
cơ sở dữ liệu cũ hơn lease đã cấu hình theo đồng hồ cơ sở dữ liệu. Hàng `SUCCESS` không bao giờ được
reclaim cho cùng danh tính logic. Dùng `runKey` mới cho mỗi lần chạy theo lịch dự kiến.

Scheduler không vận chuyển công việc hoặc giữ backlog queue. Dùng [BullMQ](../queue.md) khi cần job
trì hoãn, retry, concurrency và phân phối worker; chỉ kết hợp cả hai khi vai trò khác biệt của chúng
đã rõ ràng.
