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

File private là mặc định. `publicFiles: true` là một quyết định bảo mật tường minh và cần được
kết hợp với policy bucket/CDN phù hợp cùng `cdnBaseUrl`.

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
| `upload()`                                 | validate, lưu hàng ẩn, ghi byte, kích hoạt hàng                                   |
| `uploadTemporary()`                        | upload chưa dùng có theo dõi; yêu cầu `cleanupAfterDays` dương                    |
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

| Method | Route                         | Status mặc định | Ghi chú                                                 |
| ------ | ----------------------------- | --------------- | ------------------------------------------------------- |
| POST   | `/uploaded-file`              | 201             | trường multipart `file`; trường query metadata tùy chọn |
| GET    | `/uploaded-file/:id/download` | 200             | attachment, MIME allowlist, `nosniff`                   |

Cả hai route đều dùng `AuthGuard`. Prefix module/router có thể thêm segment. Adapter multipart cho phép
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

`ScheduleModule.forRoot()` kích hoạt job maintenance tích hợp hằng ngày lúc 03:00. Job luôn retry
deletion claim pending đủ điều kiện và cũng xóa file chưa dùng cũ hơn `cleanupAfterDays` khi
được cấu hình. Bật `jobScheduler: {}` để rào sweep này giữa nhiều instance.

Để retire một tombstone có producer đã biến mất vĩnh viễn, trước tiên hãy dừng/drain mọi producer và xác minh
rằng object được tạo của nó không thể tiếp tục được ghi. Operator đáng tin cậy sau đó có thể gọi
`unsafeSystemRetireUploadTombstone(id)`; method này từ chối upload/deletion lease còn hiệu lực và chỉ chuyển
tombstone hết hạn chính xác thành retry xóa đã trôi qua thông thường.

::: danger Ranh giới maintenance không an toàn
Mọi method `unsafeSystem*` chủ động bỏ qua request policy tenant/owner trên tất cả tenant.
Chỉ gọi chúng từ maintenance worker được phân quyền riêng. Prefix `unsafeSystem` là một phần
của contract.
:::

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
