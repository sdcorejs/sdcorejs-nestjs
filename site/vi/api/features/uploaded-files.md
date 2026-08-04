# API file tải lên {#uploaded-files-api}

Đường dẫn import: `@sdcorejs/nestjs/features`

Feature uploaded-file lưu metadata trong PostgreSQL và byte trên ổ đĩa local hoặc S3. Mỗi thao tác
thông thường phân giải scope tenant/owner tin cậy, áp dụng authorization policy và dùng lỗi không
tiết lộ thông tin định danh cho resource không hợp lệ, bị thiếu, bị từ chối hoặc khác scope.

## Các export {#exports}

| Export                               | Loại         | Mục đích                                                     |
| ------------------------------------ | ------------ | ------------------------------------------------------------ |
| `UploadedFile<TExtraData>`           | entity class | Metadata cùng trạng thái upload/deletion bền vững            |
| `UploadedFileService`                | class        | API upload, lookup, download, attach và deletion có cấp quyền |
| `UploadedFileModule`                 | class        | Module feature global; `forRoot(config)`                     |
| `UploadedFileController`             | class        | Bề mặt HTTP upload/download có xác thực, tùy chọn            |
| `UploadedFileConfig`                 | interface    | Cấu hình driver, validation, scope, authorization và cleanup |
| `UploadedFileContext`                | type         | Request context tin cậy được các thao tác service chấp nhận  |
| `UploadedFileOperation`              | type         | gồm `create`, `read`, `complete`, `abort` và thao tác legacy |
| `UploadedFileAccessDecision`         | type         | `'owner' \| 'tenant' \| 'deny'`                              |
| `UploadedFileScope`                  | interface    | Tenant, department tùy chọn và owner ID                      |
| `UploadedFileAuthorizationRequest`   | interface    | Đầu vào policy với context tin cậy và resource có giới hạn   |
| `UploadedFileAuthorizationPolicy`    | type         | Callback decision sync/async có giới hạn                     |
| `UploadedFileAttachment`             | interface    | Ownership attachment chính xác theo module/entity/entityId   |
| `UploadedFileAttachedReadRequest`    | interface    | Scope tin cậy và attachment cho thao tác đọc                 |
| `UploadedFileAttachedReadPolicy`     | type         | Callback đọc attachment mặc định từ chối                     |
| `UploadedFileMeta`                   | interface    | Nguồn gốc module/entity/entityId/type tùy chọn                |
| `UploadedFileUploadOptions`          | interface    | MIME khai báo và giới hạn validation theo lời gọi            |
| `UploadedFileTemporaryUploadOptions` | type         | Option temporary managed; cấm visibility/TTL                 |
| `InitiateUploadedFileInput`          | interface    | Tên gốc, content type khai báo, size chính xác, checksum      |
| `InitiateUploadedFileResult`         | interface    | Upload instruction một object, trung lập provider            |
| `UploadedFileResult`                 | interface    | Kết quả service có URL; giữ key/CDN legacy ở lớp internal    |
| `UploadedFileHttpResult`             | type         | Kết quả HTTP đã loại `key` và `cdn` persist                  |
| `UploadedFileVisibility`             | type         | `'public' \| 'private'`                                      |
| `UploadedFilePublicAccessMode`       | type         | Chính sách object public `'object-acl' \| 'external'`        |
| `UploadedFileStatus`                 | type         | `'pending' \| 'completing' \| 'ready' \| 'failed'`          |
| `UploadedFileDisposition`            | type         | `'inline' \| 'attachment'`                                   |
| `UploadedFileDirectLifecycle1785744000000` | migration class | Migration PostgreSQL additive cho lifecycle          |
| `UploadedFileRemoteCloneConfig`      | type         | Điều khiển bật/timeout/kích thước/redirect/host              |
| `UPLOADED_FILE_BATCH_LIMIT`          | value        | `100` ID/reference mỗi batch công khai                       |
| `UPLOADED_FILE_REFERENCE_MAX_LENGTH` | value        | `1024` ký tự cho mỗi reference chính xác                     |
| `UPLOADED_FILE_CONFIG`               | value        | DI token cấu hình feature đã phân giải                       |

Raw storage driver, helper storage-key và provider bảo trì chủ ý không được export, nhờ đó mã ứng
dụng không thể bypass authorization của service bằng object key tùy ý.

## Đăng ký entity và thiết lập module {#entity-registration-and-module-setup}

```ts
TypeOrmModule.forRoot({
  type: 'postgres',
  // ...
  entities: [UploadedFile],
});

UploadedFileModule.forRoot({
  driver: 'local',
  localRoot: './var/uploads',
  host: 'https://api.example.com',
  cleanupAfterDays: 7,
  resolveScope: (ctx) => ({
    tenantCode: ctx.tenant,
    departmentCode: typeof ctx.custom?.departmentCode === 'string' ? ctx.custom.departmentCode : undefined,
    userId: ctx.userId,
  }),
  authorizationPolicy: ({ operation, context }) => {
    if (operation === 'read' && context.roles?.includes('tenant-file-reader')) return 'tenant';
    return 'owner';
  },
  attachedReadPolicy: ({ context, attachment }) =>
    attachment.module === 'cms' &&
    attachment.entity === 'asset' &&
    context.permissions?.includes('cms.asset.view'),
});
```

Thêm `UploadedFile` vào datasource. Entity dùng UUID, `jsonb`, `timestamptz`, cột soft-delete và có
`key`/`cdn` unique. Direct lifecycle thêm `sizeBytes` chính xác, `contentType`, `pendingKey`,
`visibility`, `status`, `isTemporary`, timestamp upload/complete/expire, `disposition`, `checksum`,
`etag` và index cho pending/temporary/owner-status.

## Cấu hình {#configuration}

| Option                  | Mặc định / constraint                                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `driver`                | Local trừ khi cặp `accessId` + `accessKey` đầy đủ, rõ ràng tự chọn S3; `'s3'` rõ ràng dùng chuỗi credential AWS                 |
| `accessId`, `accessKey` | Tùy chọn nhưng phải được cung cấp cùng nhau và không rỗng                                                                        |
| `region`                | Chuỗi provider AWS SDK khi bỏ qua                                                                                                |
| `endpoint`              | S3-compatible origin tùy chọn, ví dụ Spaces endpoint                                                                             |
| `forcePathStyle`        | `false`; dành cho compatible origin yêu cầu path-style addressing                                                                |
| `bucket`                | Bắt buộc và không rỗng với S3                                                                                                    |
| `folder`                | `'core'`; được chuẩn hóa, từ chối segment traversal                                                                              |
| `localRoot`             | `<cwd>/upload`; đường dẫn tuyệt đối chuẩn                                                                                         |
| `host`                  | Rỗng; base cho URL private có xác thực                                                                                           |
| `cdnBaseUrl`            | Rỗng; base public read ổn định, không bao giờ là presigned PUT origin                                                            |
| `defaultVisibility`     | `'private'`; mặc định cho managed internal upload                                                                                |
| `allowPublicUploads`    | `false`; bắt buộc trước khi internal caller yêu cầu public                                                                       |
| `publicAccessMode`      | `'external'`; `'object-acl'` gửi `public-read`, external không gửi ACL                                                          |
| `publicFiles`           | Input tương thích đã deprecated; `true` chuẩn hóa permanent, không áp dụng temporary                                            |
| `uploadUrlTtlSeconds`   | `600`; số nguyên dương, tối đa một giờ                                                                                           |
| `privateDownloadUrlTtlSeconds` | `900`; không vượt maximum cấu hình/trần tuyệt đối một giờ                                                                |
| `maxPrivateDownloadUrlTtlSeconds` | `3600`; không thể vượt một giờ                                                                                        |
| `pendingCleanupInterval` | `'0 3 * * *'`; sweep direct pending/staging/outbox/legacy age                                                                  |
| `temporaryCleanupInterval` | `'*/15 * * * *'`; sweep temporary ready đã hết hạn                                                                           |
| `cleanupBatchSize`      | `100`; số nguyên dương, tối đa 100                                                                                               |
| `downloadPath`          | `'uploaded-file'`                                                                                                                |
| `maxFileSizeBytes`      | Mặc định 10 MiB; giới hạn theo trần tuyệt đối 25 MiB                                                                             |
| `allowedMimeTypes`      | JSON, PDF, ZIP, DOCX, XLSX, PPTX, GIF, JPEG, PNG, WebP, CSV và plain text                                                        |
| `validateMagicBytes`    | `true`                                                                                                                          |
| `remoteClone`           | Tắt; mặc định 5s, tối đa bằng service size, 3 redirect (tối đa tuyệt đối 5)                                                      |
| `resolveScope`          | Fallback về `ctx.tenant`, `ctx.userId`, rồi các trường `ctx.custom` tương ứng                                                    |
| `authorizationPolicy`   | Chỉ owner khi vắng mặt                                                                                                          |
| `attachedReadPolicy`    | Từ chối đọc attachment khi vắng mặt; chỉ giá trị `true` chính xác mới cho phép                                                   |
| `cleanupAfterDays`      | Chỉ age purge row legacy chưa dùng; không điều khiển TTL temporary cố định 24 giờ                                                |

`allowedHosts` từ xa là allowlist hostname chính xác tùy chọn. Khi bật clone, mọi URL và redirect
đều được validation lại, DNS phải phân giải thành địa chỉ public, kết nối được pin vào địa chỉ đã
validation, response size bị giới hạn và byte tải xuống vẫn phải qua validation upload thông
thường.

## Authorization policy {#authorization-policy}

```ts
type UploadedFileAccessDecision = 'owner' | 'tenant' | 'deny';
```

Service luôn thêm `tenantCode`; khi scope chứa `departmentCode`, nó cũng thêm predicate đó. Decision
`owner` bổ sung `userId`; `tenant` chỉ bỏ predicate owner và không thể bỏ boundary
tenant/department. Exception policy và decision không xác định trở thành deny.

Policy nhận UUID resource đã validation và reference storage chính xác, không bao giờ nhận raw SQL.
ID và reference được giới hạn trước khi callback chạy.

## Các method service {#service-methods}

| Thành viên                          | Signature / kết quả                                                                         |
| ----------------------------------- | ------------------------------------------------------------------------------------------- |
| `getContent`                        | `(fileName?) => { ContentType?, ContentDisposition? }`; ánh xạ extension allowlist thuần     |
| `upload<T>` legacy                  | `(buffer, fileName?, meta?, extraData?, options?) => Promise<UploadedFile<T>>`              |
| `upload` managed                    | `(source, originalName, context?, ownerId?, options?) => Promise<UploadedFileResult>`        |
| `uploadTemporary` legacy            | `(buffer, fileName?, options?) => Promise<{ key, cdn }>`                                    |
| `uploadTemporary` managed           | `(source, originalName, context?, ownerId?, options?) => Promise<UploadedFileResult>`        |
| `initiateUpload` / `initiateTemporaryUpload` | `(input) => Promise<InitiateUploadedFileResult>`                                     |
| `completeUpload` / `abortUpload`    | `(id) => Promise<UploadedFileResult \| void>`                                               |
| `resolveUrl`                        | `(id) => Promise<{ url, urlExpiredAt }>`                                                    |
| `find`                              | `(id) => Promise<UploadedFileResult>`                                                       |
| `deleteById`                        | `(id) => Promise<void>`; abort pending hoặc delete ready qua durable cleanup                |
| `putUploadContent`                  | `(id, buffer) => Promise<UploadedFileResult>`; chỉ local target đã xác thực                 |
| `cloneFromUrl<T>`                   | `(url, fileName?, meta?, extraData?) => Promise<UploadedFile<T>>`                           |
| `download`                          | `(id) => Promise<{ stream, fileName }>`                                                     |
| `downloadAttached`                  | `(id, attachment) => Promise<{ stream, fileName }>`; đọc attachment chính xác đã được duyệt |
| `findById<T>`                       | `(id) => Promise<UploadedFile<T>>`                                                          |
| `setExtraData<T>`                   | `(id, extraData: Partial<T>) => Promise<void>`                                              |
| `markUsed`                          | `(ids, meta?, manager?) => Promise<void>`; transaction của caller là tùy chọn               |
| `useFiles`                          | `(references, entity?, entityId?) => Promise<void>`                                         |
| `delete`                            | `(references) => Promise<void>`; xóa object bền vững                                       |
| `changeFiles`                       | `(olds, news, entity?, entityId?) => Promise<void>`                                         |
| `unsafeSystemRetryPendingDeletions` | `(limit = 100) => Promise<number>`; chỉ bảo trì cross-tenant                                |
| `unsafeSystemRetireUploadTombstone` | `(id) => Promise<boolean>`; chỉ upload bị bỏ quên do operator xác nhận                       |
| `unsafeSystemPurgeUnusedBefore`     | `(cutoff) => Promise<number>`; chỉ bảo trì cross-tenant                                     |
| `cleanupPendingUploads`             | `(limit?) => Promise<number>`; sweep direct pending/staging và deletion retry               |
| `cleanupExpiredTemporaryFiles`      | `(now?, limit?) => Promise<number>`; cleanup CAS theo expiry chính xác                      |
| `unsafeSystemCleanupCompletedStaging` | `(limit?) => Promise<number>`; cleanup S3 staging còn giữ                                 |

```ts
const file = await uploads.upload(
  buffer,
  'invoice.pdf',
  { module: 'billing', entity: 'invoice', entityId: invoiceId, type: 'attachment' },
  { checksum: sha256 },
  { contentType: 'application/pdf' },
);

await uploads.markUsed([file.id], {
  module: 'billing',
  entity: 'invoice',
  entityId: invoiceId,
  type: 'attachment',
});
```

`module`, `entity`, `entityId` và `type` chỉ là nguồn gốc; chúng không phải decision phân quyền
domain-resource. Trước khi gọi `markUsed`, `useFiles` hoặc `changeFiles`, host phải tải và cấp quyền
resource domain đích trong mô hình tenant/permission của chính mình. Lookup tích hợp theo `entityId`
không tự cấp quyền độc lập cho resource đích đó.

Đường upload validation buffer không rỗng có giới hạn, tên đã làm sạch, allowlist MIME, sự phù hợp
extension/content và signature/UTF-8 thực tế khi bật. Storage key chứa UUID server và namespace
tenant đã encode; filename của caller không phải boundary unique.
Mỗi lời gọi upload có thể thu hẹp `allowedMimeTypes` và `maxFileSizeBytes`; các giá trị này được lấy
giao hoặc chặn theo cấu hình module và không thể mở rộng cấu hình.

DOCX, XLSX và PPTX còn được kiểm tra cấu trúc ZIP có giới hạn: tối đa 2.048 entry, tổng dữ liệu
uncompressed khai báo 100 MiB, 50 MiB mỗi entry và tỷ lệ nén 100:1 mỗi entry. Package mã hóa,
ZIP64/multi-disk, path không an toàn hoặc trùng, offset directory sai, thiếu `[Content_Types].xml`
hoặc main part tương ứng đều bị từ chối. Validation này không phải quét malware.

Khi consumer truyền `EntityManager`, `markUsed` xác minh và cập nhật qua manager đó mà không mở
transaction lồng; nếu bỏ qua, thư viện mở đúng một transaction riêng. `downloadAttached` trước tiên
yêu cầu `attachedReadPolicy` trả về chính xác `true`, sau đó vẫn áp dụng tenant tin cậy và metadata
attachment active, đã dùng, khớp chính xác. Domain `entityId` UUIDv7 được hỗ trợ. Uploader ban đầu
chủ ý không nằm trong lookup attachment chính xác này.

## Vòng đời pending bền vững {#durable-pending-lifecycle}

Direct initiate persist `status: 'pending'`, staging key private, final key sinh riêng, expected
size/content type chính xác, upload expiry và in-flight cleanup lease trước khi trả target. Complete
verify staging version, CAS-claim `pending → completing`, promote mà không download qua backend,
verify final metadata rồi CAS-finalize `ready`. Completion lease ngăn hai instance promote độc lập;
lease hết hạn có thể recovery. S3 staging được giữ để retry rồi xóa idempotent; local promotion dùng
hard-link/move không overwrite và xóa `pendingKey`.

File public ready dùng URL ổn định với expiry null. Private S3/Spaces dùng presigned GET mới, tối đa
một giờ; signed URL không persist hay log. Temporary mới luôn private và complete thành công ghi
`expiredAt = completedAt + 24 elapsed hours`. Read/detail từ chối tại `now >= expiredAt` độc
lập với cleanup và clamp signed URL cuối theo boundary đó.

Upload trước tiên được persist thành một hàng ẩn có `uploadPendingAt` là activation lease trong
tương lai 15 phút; `deletionPendingAt` vẫn null. Sau khi ghi byte, activation dùng
compare-and-swap (CAS): chỉ xóa chính xác upload marker đó khi deletion marker vẫn null. Các thao tác
đọc và mutation thông thường yêu cầu cả hai trường pending đều null, vì vậy hàng đang xử lý và thất
bại không hiển thị.

Nếu việc ghi hoặc activation thất bại, settled cleanup xóa nguyên tử chính xác upload marker và đặt
deletion claim mới có thời điểm tương lai trước khi chạm storage. Late activation vẫn mong đợi
marker gốc vì vậy tác động 0 hàng và không thể hồi sinh metadata trong lúc byte đang bị xóa. Nếu
activation thực sự đã commit nhưng response bị mất, việc xác nhận active-row ngăn cleanup. Nếu
maintenance gặp upload đã hết hạn trong lúc storage write của nó vẫn chậm, writer sau đó
CAS-settle chính xác trạng thái hiện tại—khôi phục nguyên tử một hàng soft-delete về trạng thái
pending ẩn khi cần—trước khi xóa key đã tạo. Vì vậy durable deletion claim tồn tại trước terminal
storage I/O. Lỗi storage hoặc finalize sẽ CAS-release claim đang sở hữu sang retry marker trong
tương lai một phút. Backoff này ngăn một batch đầy object liên tục thất bại chiếm mọi sweep có giới
hạn; claim bị bỏ quên đủ điều kiện trở lại khi lease hoặc thời gian retry hết hạn.

Tương tự, `delete()` claim hàng thành pending trước khi xóa byte và soft-delete metadata.
`unsafeSystemRetryPendingDeletions()` ưu tiên deletion claim đã settle, rồi dùng phần capacity batch
còn lại cho upload tombstone hết hạn. Nó CAS-claim chính xác upload marker, deletion marker và trạng
thái soft-delete trước storage I/O. Worker cũ bị mất CAS sẽ bỏ qua deletion. Settled deletion thành
công xóa claim của nó. Upload chưa được giải quyết giữ cả tombstone `uploadPendingAt` và deletion
claim trong tương lai sau soft-delete, vì vậy producer-process chết không thể xóa tín hiệu retry;
sweep sau sẽ restore, delete và lên lịch lại. Cron drain tối đa mười batch 100 hàng mỗi lần chạy.
Hàng thất bại rời khỏi cửa sổ đủ điều kiện trước query tiếp theo, cho phép các hàng sau tiến qua
queue có giới hạn.

Tombstone chưa giải quyết chủ ý bền vững cho tới khi writer settle. Sau khi dừng và drain mọi
producer process, đồng thời xác minh object được tạo không thể tiếp tục được ghi, operator có thể
gọi `unsafeSystemRetireUploadTombstone(id)`. Method này chuyển nguyên tử chính xác tombstone hết hạn
thành trạng thái deletion-retry đã trôi qua thông thường và từ chối retire upload lease đang sống
hoặc chiếm deletion lease đang sống.

`UploadedFileModule` đăng ký hai cron pending và temporary cấu hình được. Import
`ScheduleModule.forRoot()` để kích hoạt. Pending/staging/deletion được retry kể cả khi
`cleanupAfterDays` bị tắt; age purge row legacy chưa dùng chỉ chạy khi retention dương. Temporary
expiry luôn 24 giờ và dùng interval riêng. Khi có `JobSchedulerService`, mỗi cron dùng distributed
lock; row CAS/outbox cũng bảo vệ nhiều instance chạy đồng thời.

::: warning API bảo trì không an toàn
Mọi method `unsafeSystem*` chủ ý bypass policy tenant/owner của request trên tất cả tenant. Chỉ gọi
chúng từ mã bảo trì nền tin cậy; không bao giờ công khai trực tiếp trong HTTP controller.
:::

## Controller tùy chọn {#optional-controller}

`UploadedFileController` không được tự động đăng ký. Thêm nó vào `controllers` của module ứng dụng:

| Route                                      | Hành vi                                                               |
| ------------------------------------------ | ---------------------------------------------------------------------- |
| `POST /uploaded-file/initiate`             | Metadata private pending và direct target trung lập provider           |
| `POST /uploaded-file/temporary/initiate`   | Temporary direct target private; không nhận TTL/visibility             |
| `POST /uploaded-file/:id/complete`         | Verify/promote/finalize; body rỗng                                     |
| `PUT /uploaded-file/:id/content`           | Raw binary target cho local driver                                     |
| `GET /uploaded-file/:id`                   | Detail có URL đã phân quyền                                            |
| `DELETE /uploaded-file/:id`                | Abort pending hoặc delete ready                                        |
| `POST /uploaded-file`                      | Route multipart tương thích đã deprecated                              |
| `GET /uploaded-file/:id/download`          | Stream tương thích với type allowlist, `nosniff`, attachment disposition |

Mọi route dùng `AuthGuard`; policy service vẫn thực thi tenant/owner. HTTP response direct không bao
giờ serialize storage key hay reference private/CDN đã persist. Giới hạn multipart
cho phép một file và thực thi trần tuyệt đối 25 MiB; service có thể thực thi giới hạn cấu hình thấp
hơn. `downloadPath` mặc định khớp controller này. Nếu tùy chỉnh nó, hãy cung cấp hành vi
routing/proxy tương ứng hoặc controller tùy chỉnh.

## Hành vi lỗi {#error-behavior}

Lỗi định danh resource, authorization và existence chủ ý dùng chung `core.file.not-found`. Lỗi
validation/vòng đời đã cấu hình dùng các code ổn định gồm `core.file.invalid-upload`,
`core.file.invalid-meta`, `core.file.remote-disabled`, `core.file.remote-fetch-failed`,
`core.file.upload-expired`, `core.file.upload-completing`, `core.file.upload-verification-failed`,
`core.file.public-upload-disabled`, `core.file.expired`, `core.file.upload-failed`,
`core.file.delete-failed` và `core.file.cleanup-failed`.

Không chuyển lỗi service không tiết lộ thông tin định danh thành chẩn đoán storage hoặc policy chi
tiết tại HTTP boundary.
