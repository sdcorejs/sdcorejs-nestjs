# API feature {#features-api}

Đường dẫn import: `@sdcorejs/nestjs/features`

Các feature có trạng thái opt-in này yêu cầu thêm entity được export vào datasource TypeORM của
ứng dụng:

- [File tải lên](./uploaded-files.md) — lưu trữ local/S3 được cấp quyền theo tenant/owner với cơ chế
  cleanup pending bền vững.
- [Lịch sử thao tác](./action-history.md) — snapshot trước/sau có scope tenant và đã che dữ liệu.
- [Job scheduler](./job-scheduler.md) — lease phân tán PostgreSQL với quyền sở hữu được fence và
  idempotency key ổn định cho lần chạy logic.

```ts
TypeOrmModule.forRoot({
  type: 'postgres',
  entities: [UploadedFile, ActionHistory, JobScheduler],
});
```

```ts
import {
  ActionHistoryModule,
  JobSchedulerModule,
  UploadedFileModule,
} from '@sdcorejs/nestjs/features';
```

`SdCoreModule.forRoot` chỉ nối dây từng feature khi có option tương ứng. `UploadedFileController` và
`ActionHistoryController` tùy chọn không được đăng ký tự động; chỉ thêm chúng vào module ứng dụng
khi bề mặt HTTP dựng sẵn phù hợp policy của bạn.

Cả ba feature dùng schema/query đặc thù PostgreSQL. Hãy áp dụng migration cho entity trước khi bật
các provider.
