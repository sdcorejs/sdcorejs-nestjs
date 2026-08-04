# Tham chiếu schema cơ sở dữ liệu {#database-schema-reference}

Các tính năng có state được định hướng cho PostgreSQL. Mã nguồn dùng `uuid`, `jsonb`, `timestamptz`,
cột enum, interval PostgreSQL, `ON CONFLICT` và biểu thức đồng hồ cơ sở dữ liệu. Test dùng `pg-mem`;
dự án không tuyên bố tương thích MySQL hay SQLite. Consumer vẫn sở hữu rollout schema; direct
lifecycle uploaded-file có một migration PostgreSQL default-schema được export.

## Các base entity dùng chung {#common-base-entities}

- `BaseEntity`: primary key UUID `id` được sinh tự động.
- `WithTimestamps(Base)`: `createdAt`, `updatedAt`, `deletedAt` nullable.
- `WithAudit(Base)`: timestamp cộng với `createdBy`, `modifiedBy`, `creator jsonb` và
  `modifier jsonb` nullable.
- `@Scoped()` không tạo cột. Hãy áp dụng nó cho một property `@Column()` thật của consumer.

## `uploaded_file` {#uploaded-file}

Các cột chính gồm UUID `id` được sinh tự động; `tenantCode` và `userId` non-null;
`departmentCode` nullable; `fileName`, `fileSize`, `fileExtension`, `key` và `cdn` bất biến; các
trường usage và provenance; `extraData jsonb` tùy chọn; `uploadPendingAt` và `deletionPendingAt`
nullable; `sizeBytes`/`contentType` chính xác; `pendingKey` private; `visibility`, `status`,
`isTemporary`, `disposition`; timestamp upload/complete/expire, checksum và ETag nullable; cùng
timestamp tiêu chuẩn và thời điểm xóa mềm. `key` và `cdn` là duy nhất.

Index bao phủ tenant/department/owner/id, owner/status, lease kích hoạt upload, deletion đang chờ,
direct pending cleanup và temporary expiry. Một upload
mới được lưu sẽ bị ẩn bằng lease `uploadPendingAt` trong tương lai trong khi byte đang được ghi;
activation xóa đúng marker của nó. `deletionPendingAt` là claim xóa storage. Maintenance giữ lại
upload tombstone chưa xử lý và deletion claim đã lên lịch qua quá trình xóa mềm, kể cả khi process
producer chết. Công việc xóa thất bại được lên lịch lại với retry marker trong tương lai để scan có
giới hạn vượt qua hàng lỗi; chỉ nhánh writer đã ổn định hoặc thao tác retire rõ ràng của operator mới
xóa upload tombstone.

## `action-history` {#action-history}

Bảng `action-history` lưu UUID `id`, `tenantCode` non-null, `table` (tối đa 256), UUID resource
`tableId`, actor snapshot tùy chọn, action enum `type`, `fromData`/`toData jsonb` tùy chọn, ghi chú và
`createdAt`. Resource index là `(tenantCode, table, tableId, createdAt)`.

`table` phải là `tablePath` TypeORM đã kèm schema và có thẩm quyền. Module ghi lịch sử;
`retentionDays` là gợi ý vận hành và không lập lịch xóa.

## `job-scheduler` {#job-scheduler}

Bảng `job-scheduler` lưu `lockKey` SHA-256 duy nhất có version, `code`/`name` có giới hạn, loại job,
status, UUID `ownerToken` xoay vòng, `data jsonb` tùy chọn và thời điểm tạo/sửa. Index bao phủ code và
`(status, modifiedAt)`. Việc acquire phụ thuộc vào xử lý conflict của PostgreSQL và so sánh stale
lease theo đồng hồ cơ sở dữ liệu.

## Kỷ luật migration {#migration-discipline}

Đăng ký feature entity thông qua `autoLoadEntities: true` hoặc đăng ký rõ ràng. Trên production, hãy
phát hành migration do ứng dụng sở hữu: thêm cột nullable, backfill/cách ly bằng dữ liệu quyền sở hữu
có thẩm quyền, xác thực, rồi thêm constraint non-null và index. Không bao giờ dựa vào
`synchronize: true` khi triển khai production. Làm theo [migration 1.0 → 1.1](/vi/migrations/1.0-to-1.1),
sau đó chạy [migration uploaded-file 1.1 → 1.2](/vi/migrations/1.1-to-1.2).
