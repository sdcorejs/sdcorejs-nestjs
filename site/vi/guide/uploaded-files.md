# File tải lên {#uploaded-files}

Tính năng file tải lên lưu metadata trong PostgreSQL và byte trong local storage hoặc S3. Mọi
thao tác service thông thường đều phân giải tenant và owner đáng tin cậy, áp dụng quyết định phân quyền có giới hạn
và trả về cùng một 404 cho tài nguyên không tồn tại lẫn không được phép.

## Bật lưu trữ local {#enable-local-storage}

```ts
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SdCoreModule } from '@sdcorejs/nestjs';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.DATABASE_URL,
      autoLoadEntities: true,
      synchronize: false,
    }),
    ScheduleModule.forRoot(),
    SdCoreModule.forRoot({
      uploadedFile: {
        driver: 'local',
        localRoot: './var/uploads',
        host: 'https://api.example.com',
        cleanupAfterDays: 7,
        maxFileSizeBytes: 8 * 1024 * 1024,
        allowedMimeTypes: ['image/png', 'image/jpeg', 'application/pdf'],
      },
    }),
  ],
})
export class AppModule {}
```

`localRoot` được canonicalize và object key là namespace tenant do server tạo. Tên file gốc
là metadata; chúng không thể chọn storage path.

## Bật S3 (AWS SDK v3) {#enable-s3-aws-sdk-v3}

```ts
const bucket = process.env.S3_BUCKET;
if (!bucket) throw new Error('S3_BUCKET is required');

SdCoreModule.forRoot({
  uploadedFile: {
    driver: 's3',
    bucket,
    region: process.env.AWS_REGION,
    folder: 'orders',
    cleanupAfterDays: 7,
  },
});
```

Đoạn mã tập trung này tái sử dụng root import ở trên. Driver S3 lazy-load
`@aws-sdk/client-s3` (AWS SDK v3). Bỏ qua `accessId` và `accessKey` để dùng chuỗi
credential provider tiêu chuẩn của AWS. Nếu cấu hình một trong hai credential tường minh, cả hai phải không trống.
Việc chọn `driver: 's3'` yêu cầu bucket. Package `aws-sdk` v2 cũ không được sử dụng.

File private là mặc định. Nên dùng `defaultVisibility`, `allowPublicUploads` và
`publicAccessMode`; `publicFiles: true` cũ được chuẩn hóa thành public cho file permanent và cho phép
internal public upload, nhưng không bao giờ làm file temporary thành public.

## Direct upload: control plane và data plane {#direct-upload-control-plane-and-data-plane}

Với S3 và DigitalOcean Spaces, backend là control plane còn object storage là data plane. Browser
không nhận credential, bucket name hay object key:

1. `POST /uploaded-file/initiate` kiểm tra metadata, tạo row private ở trạng thái `pending` và trả một
   upload target ngắn hạn, trung lập provider.
2. Browser gửi file trực tiếp bằng đúng method và toàn bộ header được trả về.
3. `POST /uploaded-file/:id/complete` kiểm tra owner, gọi `HEAD` staging object, so khớp chính xác
   size/content type/upload metadata, claim bằng CAS và promote bằng copy/move phía storage.
4. Backend chuyển row sang `ready` và trả preview URL. Complete lặp lại là idempotent; replay staging
   PUT không thể ghi đè final object đã ready.

```ts
const initiated = (await api.post('/uploaded-file/initiate', {
  originalName: file.name,
  contentType: file.type,
  size: file.size,
})).data;

await fetch(initiated.upload.url, {
  method: initiated.upload.method,
  headers: initiated.upload.headers,
  body: file,
});

const uploadedFile = (await api.post(`/uploaded-file/${initiated.id}/complete`)).data;
preview.src = uploadedFile.url;
```

Local driver trả cùng contract, nhưng target là route đã xác thực
`PUT /uploaded-file/:id/content`. Frontend không cần rẽ nhánh theo provider.
Target local dùng `application/octet-stream` chỉ làm transport byte thô để body parser của Nest không
biến đổi byte JSON; row vẫn giữ `contentType` đã được validation.

## Visibility, URL và hạn temporary {#visibility-url-and-temporary-expiry}

| File ready | `url` trong detail | `urlExpiredAt` |
| --- | --- | --- |
| Public | `cdnBaseUrl` ổn định hoặc URL origin S3-compatible | `null` |
| Private S3/Spaces | Presigned GET mới | Tối đa một giờ |
| Private local | Route download được backend bảo vệ | `null` |
| Pending/completing/failed | `null` | `null` |

Generic browser initiate luôn private. Public upload là quyết định của internal service và bị từ
chối nếu thiếu `allowPublicUploads: true`. Với `publicAccessMode: 'object-acl'`, promotion gửi
`public-read`; với `'external'`, không gửi ACL và operator phải có bucket/CDN policy đã review.
Tên host CDN chỉ quyết định cách tạo URL, không tự làm object trở thành public.

Temporary initiate luôn private và không nhận `visibility`, `ttlSeconds` hay `expiredAt`. Khi complete
thành công, `expiredAt` đúng bằng `completedAt + 24 elapsed hours`. Truy cập bị từ chối tại
`now >= expiredAt` dù cleanup chưa chạy. Presigned GET cuối được clamp để `urlExpiredAt` không vượt
quá thời điểm hết hạn file.

```ts
const temporary = (await api.post('/uploaded-file/temporary/initiate', {
  originalName: file.name,
  contentType: file.type,
  size: file.size,
})).data;
// PUT with temporary.upload, then POST /uploaded-file/:id/complete.
```

Presigned PUT/GET URL là bearer credential: không persist, không log và không đưa vào analytics.
Detail luôn kiểm tra tenant/owner trước khi ký URL.

## S3, Spaces, CDN và CORS {#s3-spaces-cdn-and-cors}

AWS S3 dùng regional origin thông thường. DigitalOcean Spaces truyền S3-compatible origin qua
`endpoint`; presigned PUT luôn dùng origin này, còn public read có thể dùng `cdnBaseUrl`:

```ts
uploadedFile: {
  driver: 's3',
  bucket: process.env.SPACES_BUCKET,
  region: 'sgp1',
  endpoint: 'https://sgp1.digitaloceanspaces.com',
  forcePathStyle: false,
  cdnBaseUrl: 'https://assets.example.com',
  defaultVisibility: 'private',
  allowPublicUploads: true,
  publicAccessMode: 'external',
}
```

Ví dụ bucket CORS (hãy thu hẹp origin và header theo ứng dụng):

```json
[
  {
    "AllowedOrigins": ["https://app.example.com"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["content-type", "x-amz-meta-*", "x-amz-checksum-sha256"],
    "ExposeHeaders": ["etag"],
    "MaxAgeSeconds": 600
  }
]
```

`content-length` đã ký ràng buộc kích thước object chính xác. Browser tự quản lý forbidden request
header này; caller nên gửi các upload header được trả về mà không thay thế chúng.

Dùng placeholder trong ví dụ và ưu tiên workload identity. Không gửi storage credential tới browser.
Giữ staging prefix private và cấu hình lifecycle rule phía provider làm lớp bảo vệ vận hành cho object
tồn tại lâu hơn trạng thái recovery trong database.

## Phạm vi và phân quyền {#scope-and-authorization}

```ts
uploadedFile: {
  driver: 'local',
  localRoot: './var/uploads',
  cleanupAfterDays: 7,
  resolveScope: (context) => ({
    tenantCode: context.tenant,
    departmentCode:
      typeof context.custom?.departmentCode === 'string'
        ? context.custom.departmentCode
        : undefined,
    userId: context.userId,
  }),
  authorizationPolicy: ({ context, operation }) => {
    if (context.roles?.includes('file-admin') && operation === 'read') {
      return 'tenant';
    }
    return 'owner';
  },
},
```

Đoạn mã này nằm trong `SdCoreModule.forRoot({...})`. Phạm vi yêu cầu tenant không trống và
user ID dạng UUID. Policy chỉ có thể trả về `owner`, `tenant` hoặc `deny`; các điều kiện tenant bắt buộc
và department tùy chọn không bao giờ có thể bị loại bỏ. Mặc định chỉ dành cho owner.

## API service {#service-api}

```ts
import { Injectable } from '@nestjs/common';
import { UploadedFileService } from '@sdcorejs/nestjs/features';

interface InvoiceFileData {
  checksum: string;
}

@Injectable()
class InvoiceAttachmentService {
  constructor(private readonly files: UploadedFileService) {}

  upload(pdf: Buffer, invoiceId: string) {
    return this.files.upload<InvoiceFileData>(
      pdf,
      'invoice.pdf',
      { module: 'billing', entity: 'invoice', entityId: invoiceId },
      { checksum: 'application-computed-checksum' },
      { contentType: 'application/pdf' },
    );
  }
}
```

| Method                                     | Mục đích                                                                          |
| ------------------------------------------ | --------------------------------------------------------------------------------- |
| `upload()`                                 | overload Buffer cũ, hoặc managed `initiate → PUT/write → complete`                |
| `uploadTemporary()`                        | overload kết quả cũ, hoặc private upload tự hết hạn đúng 24 giờ                    |
| `initiateUpload()`                         | browser upload target private, trung lập provider                                 |
| `initiateTemporaryUpload()`                | browser upload target private và temporary                                        |
| `completeUpload()` / `abortUpload()`       | verify/promote object ready, hoặc abort pending bền vững                           |
| `find()` / `resolveUrl()`                  | detail có URL an toàn hoặc URL mới đã phân quyền                                  |
| `deleteById()`                             | xóa final và staging còn giữ qua durable outbox                                    |
| `cleanupPendingUploads()`                  | sweep pending/staging/deletion retry có giới hạn                                  |
| `cleanupExpiredTemporaryFiles()`           | claim CAS và xóa temporary ready đã hết hạn                                        |
| `cloneFromUrl()`                           | bật tường minh, tải từ xa được harden chống SSRF rồi upload bình thường           |
| `download(id)`                             | stream đã phân quyền và tên file được làm sạch                                    |
| `findById(id)`                             | metadata đang hoạt động đã phân quyền                                             |
| `setExtraData(id, data)`                   | thay thế metadata có phạm vi                                                      |
| `markUsed(ids, meta?)`                     | đánh dấu một batch UUID có giới hạn là đã dùng                                    |
| `useFiles(references, entity?, entityId?)` | đánh dấu chính xác tham chiếu key/private-URL là đã dùng                          |
| `delete(references)`                       | xóa bền vững có phạm vi                                                           |
| `changeFiles(olds, news, ...)`             | đính kèm tham chiếu mới, sau đó xóa tham chiếu đã bỏ                              |

Batch ID/reference bị giới hạn ở 100; reference bị giới hạn ở 1024 ký tự. Chuỗi metadata
được giới hạn và `entityId` phải là UUID.

Managed internal overload nhận `Buffer | Uint8Array | Readable`. `Readable` phải có
`options.size` chính xác, chỉ được consume một lần và không retry. Service gửi đúng signed
method/header, kiểm tra response, complete upload và best-effort abort mà không che lỗi gốc.

```ts
// CMS cover: stable public URL; requires allowPublicUploads.
const cover = await files.upload(buffer, 'cover.png', { module: 'cms', type: 'cover' }, ownerId, {
  contentType: 'image/png',
  visibility: 'public',
  disposition: 'inline',
});

// Contract/HRM attachment: short-lived private preview URL.
const contract = await files.upload(buffer, 'contract.pdf', { module: 'hrm', type: 'contract' }, ownerId, {
  contentType: 'application/pdf',
  visibility: 'private',
});

// Temporary preview: always private; no caller-controlled TTL.
const temporary = await files.uploadTemporary(buffer, 'preview.png', { module: 'cms' }, ownerId, {
  contentType: 'image/png',
});
```

::: warning Phân quyền miền vẫn do ứng dụng sở hữu
`module`, `entity`, `entityId` và `type` chỉ ghi lại nguồn gốc. Trước khi gọi `upload`,
`markUsed`, `useFiles` hoặc `changeFiles`, hãy tải order/invoice/etc. đích trong tenant hiện tại
và thực thi permission miền của caller. File policy không thể chứng minh quyền truy cập tài nguyên đó.
:::

## Gắn private controller một cách tường minh {#mount-the-private-controller-explicitly}

`UploadedFileModule` không tự động đăng ký HTTP controller. Chỉ gắn controller khi ứng dụng
chủ động muốn cung cấp các route tích hợp đã xác thực:

```ts
import { Module } from '@nestjs/common';
import { UploadedFileController } from '@sdcorejs/nestjs/features';

@Module({
  controllers: [UploadedFileController],
})
export class FileHttpModule {}
```

Các route:

| Method | Route                                   | Status mặc định | Ghi chú                                                   |
| ------ | --------------------------------------- | --------------- | --------------------------------------------------------- |
| POST   | `/uploaded-file/initiate`               | 201             | metadata private pending; upload target trung lập provider |
| POST   | `/uploaded-file/temporary/initiate`     | 201             | temporary upload private pending                          |
| POST   | `/uploaded-file/:id/complete`           | 201             | body rỗng; verify và promote                               |
| PUT    | `/uploaded-file/:id/content`            | 200             | binary target có giới hạn cho local driver                 |
| GET    | `/uploaded-file/:id`                    | 200             | detail đã phân quyền cùng preview URL dùng được            |
| DELETE | `/uploaded-file/:id`                    | 200             | abort pending hoặc delete ready; `{ data: null }`          |
| POST   | `/uploaded-file`                        | 201             | route multipart tương thích, đã deprecated                 |
| GET    | `/uploaded-file/:id/download`           | 200             | stream tương thích, MIME allowlist, `nosniff`               |

Mọi route đều dùng `AuthGuard`. Prefix module/router có thể thêm segment. Initiate từ chối field lạ,
kể cả public visibility, TTL, bucket và object key. HTTP result loại `key`, `pendingKey` và `cdn` đã
persist. Adapter multipart cho phép
một file, bốn trường, tổng cộng năm part và áp dụng mức trần tuyệt đối 25 MiB trước giới hạn service thấp hơn
đã cấu hình.

Cấu hình `jwt` trong `SdCoreModule` (hoặc import `JwtModule` tùy chỉnh) trước khi gắn
controller này. Principal đã xác minh phải phân giải thành user ID dạng UUID và tenant có thể dùng cho phạm vi file.

## Vòng đời pending-first bền vững {#durable-pending-first-lifecycle}

Upload thông thường hoặc tạm thời tuân theo thứ tự này:

1. validate input và tạo key bất biến;
2. lưu một hàng cơ sở dữ liệu ẩn với activation lease `uploadPendingAt` chính xác;
3. ghi object;
4. kích hoạt có điều kiện chính hàng pending đó.

Kích hoạt chỉ xóa upload lease gốc chính xác trong khi `deletionPendingAt` là null. Thao tác ghi thất bại hoặc
không rõ ràng sẽ settle marker đó một cách nguyên tử thành deletion claim trước khi dọn dẹp. Thao tác đọc active
yêu cầu cả hai trường pending là null.

Maintenance giữ một tombstone `uploadPendingAt` chưa được giải quyết cùng deletion claim theo lịch ngay cả
sau khi soft delete. Nếu thao tác ghi object chậm hoàn thành sau cleanup, writer còn sống sẽ settle và
xóa nó; nếu tiến trình producer chết, các sweep sau tiếp tục xóa và lên lịch lại tombstone.
Deletion đã settle được ưu tiên và job hằng ngày xử lý các batch có giới hạn, do đó tombstone bị bỏ rơi
không thể làm cleanup thông thường bị thiếu tài nguyên. Lỗi storage/finalization được lên lịch lại với backoff
tương lai một phút; vì vậy truy vấn có giới hạn tiếp theo có thể đi đến các hàng phía sau thay vì liên tục chọn
cùng một batch lỗi.

Tương tự, quá trình xóa đánh dấu các hàng đã phân quyền là pending trước khi xóa byte và soft-delete hàng.

`ScheduleModule.forRoot()` kích hoạt hai job cấu hình được. `pendingCleanupInterval` mặc định
`0 3 * * *`; job retire direct upload đã hết hạn sau safety lease, xóa staging còn giữ, retry durable
deletion outbox và có thể xóa row legacy chưa dùng cũ hơn `cleanupAfterDays`.
`temporaryCleanupInterval` mặc định `*/15 * * * *` và claim row ready có `expiredAt <= now`.
`cleanupBatchSize` mặc định 100 và tối đa 100. `jobScheduler: {}` thêm distributed scheduler lock;
CAS ở row và storage delete idempotent vẫn là ranh giới đúng đắn giữa nhiều instance.

Để retire một tombstone có producer đã biến mất vĩnh viễn, trước tiên hãy dừng/drain mọi producer và xác minh
rằng object được tạo của nó không thể tiếp tục được ghi. Operator đáng tin cậy sau đó có thể gọi
`unsafeSystemRetireUploadTombstone(id)`; method này từ chối upload/deletion lease còn hiệu lực và chỉ chuyển
tombstone hết hạn chính xác thành retry xóa đã trôi qua thông thường.

::: danger Ranh giới maintenance không an toàn
Mọi method `unsafeSystem*` chủ động bỏ qua request policy tenant/owner trên tất cả tenant.
Chỉ gọi chúng từ maintenance worker được phân quyền riêng. Prefix `unsafeSystem` là một phần
của contract.
:::

## Migration {#migration}

Đăng ký và chạy `UploadedFileDirectLifecycle1785744000000` trước khi deploy code tạo direct upload.
Migration chỉ thêm cột nullable/có default và cleanup index, rồi backfill row cũ thành `private`,
`ready`, non-temporary. Migration cố ý để `sizeBytes`, `contentType`, completion/expiry timestamp là
null vì không thể khôi phục an toàn từ metadata legacy đã làm tròn. `key`, `cdn`, multipart call và
download route cũ vẫn được giữ.

Nếu deployment chủ động dùng `publicFiles: true`, hãy review bucket/CDN access và chỉ backfill public
cho đúng các row cần giữ public sau migration bảo thủ. Không mặc định biến toàn bộ dữ liệu legacy
thành public. Xem [hướng dẫn migration 1.1 → 1.2](/vi/migrations/1.1-to-1.2).

## Clone từ xa {#remote-cloning}

Clone từ xa mặc định bị tắt:

```ts
remoteClone: {
  enabled: true,
  allowedHosts: ['assets.example.com'],
  timeoutMs: 5_000,
  maxBytes: 8 * 1024 * 1024,
  maxRedirects: 2,
},
```

Fetcher chấp nhận HTTP(S), từ chối credential trong URL và địa chỉ không public, validate mọi DNS
answer, pin địa chỉ đã chọn, validate lại từng redirect và áp dụng giới hạn time/size/redirect.
Giữ `allowedHosts` hẹp dù kiểm tra địa chỉ public cũng được thực thi.
