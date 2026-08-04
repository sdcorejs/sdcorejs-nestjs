# Tệp đã tải lên {#uploaded-files}

Ví dụ này dùng object S3 riêng tư, mount controller xác thực tích hợp sẵn và gắn reference tệp đã
tải lên vào đơn hàng.

## Cấu hình S3 và cleanup {#configure-s3-and-cleanup}

```ts
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SdCoreModule } from '@sdcorejs/nestjs';
import { UploadedFileController } from '@sdcorejs/nestjs/features';

const bucket = process.env.S3_BUCKET;
if (!bucket) throw new Error('S3_BUCKET is required');
const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) throw new Error('JWT_SECRET is required');

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
      jwt: { secret: jwtSecret },
      uploadedFile: {
        driver: 's3',
        bucket,
        region: process.env.AWS_REGION,
        folder: 'orders',
        host: 'https://api.example.com',
        maxFileSizeBytes: 8 * 1024 * 1024,
        allowedMimeTypes: ['image/png', 'image/jpeg', 'application/pdf'],
        cleanupAfterDays: 7,
        resolveScope: (context) => ({
          tenantCode: context.tenant,
          departmentCode:
            typeof context.custom?.departmentCode === 'string'
              ? context.custom.departmentCode
              : undefined,
          userId: context.userId,
        }),
        authorizationPolicy: ({ context, operation }) =>
          context.roles?.includes('file-admin') && operation === 'read'
            ? 'tenant'
            : 'owner',
      },
      jobScheduler: {},
    }),
  ],
  controllers: [UploadedFileController],
})
export class FileModule {}
```

Driver S3 dùng `@aws-sdk/client-s3` v3. Cấu hình này không chỉ định credential và dùng credential
provider chain tiêu chuẩn của AWS. Nếu đặt `accessId` hoặc `accessKey`, cả hai đều bắt buộc.
`autoLoadEntities` đăng ký `UploadedFile` và `JobScheduler`; hãy tạo migration. Token đã xác minh phải
cung cấp UUID `sub` cùng `tenant` (principal resolver mặc định ánh xạ cả hai); hãy cấu hình principal
resolver tùy chỉnh khi tên claim của bạn khác.

Controller là private/opt-in: nó chỉ được expose vì xuất hiện trong `controllers`. Controller thêm
`AuthGuard` và cung cấp:

- `POST /uploaded-file` (multipart field `file`) → HTTP 201;
- `GET /uploaded-file/:id/download` → HTTP 200 attachment.

## Upload và attach {#upload-and-attach}

Response upload bao gồm một `key` bất biến và reference download `cdn` riêng tư. Lưu một trong các
reference chính xác đó vào payload đơn hàng, sau đó đánh dấu là đã dùng:

```ts
import { Injectable } from '@nestjs/common';
import { UploadedFileService } from '@sdcorejs/nestjs/features';

interface CreateOrderInput {
  orderId: string;
  attachmentReferences: string[];
}

abstract class OrderAccessPolicy {
  abstract assertCanManageAttachments(orderId: string): Promise<void>;
}

@Injectable()
class OrderAttachmentService {
  constructor(
    private readonly files: UploadedFileService,
    private readonly orders: OrderAccessPolicy,
  ) {}

  async attach(input: CreateOrderInput): Promise<void> {
    await this.orders.assertCanManageAttachments(input.orderId);
    await this.files.useFiles(
      input.attachmentReferences,
      'order',
      input.orderId,
    );
  }

  async replace(
    orderId: string,
    oldReferences: string[],
    newReferences: string[],
  ): Promise<void> {
    await this.orders.assertCanManageAttachments(orderId);
    await this.files.changeFiles(
      oldReferences,
      newReferences,
      'order',
      orderId,
    );
  }
}
```

`orderId` và mọi file ID phải là UUID. Batch reference là all-or-nothing, được deduplicate và giới
hạn ở 100. Reference bị thiếu, sai định dạng, khác tenant và bị từ chối đều không được phân biệt.
`OrderAccessPolicy` đại diện cho quá trình load và phân quyền đơn hàng đích do ứng dụng sở hữu trong
tenant hiện tại; metadata provenance của tệp không bao giờ cấp quyền truy cập domain resource đó.

## Upload trực tiếp qua service {#direct-service-upload}

```ts
const uploaded = await files.upload(
  pdfBuffer,
  'invoice.pdf',
  { module: 'billing', entity: 'order', entityId: orderId, type: 'invoice' },
  { source: 'generated' },
  { contentType: 'application/pdf' },
);

await files.markUsed([uploaded.id], {
  entity: 'order',
  entityId: orderId,
  type: 'invoice',
});
```

Phân quyền và load đơn hàng được tham chiếu trước cả hai lời gọi. Các field `module`, `entity`,
`entityId` và `type` chỉ là metadata audit/provenance; `UploadedFileService` không suy ra permission
đơn hàng hoặc hóa đơn từ chúng.

Fragment chuyên biệt này giả định `files: UploadedFileService` đã được inject,
`pdfBuffer: Buffer` thuộc ứng dụng và `orderId` là UUID.

## Browser direct upload và managed internal upload {#browser-direct-upload-and-managed-internal-upload}

```ts
const initiated = (await api.post('/uploaded-file/initiate', {
  originalName: browserFile.name,
  contentType: browserFile.type,
  size: browserFile.size,
})).data;

await fetch(initiated.upload.url, {
  method: initiated.upload.method,
  headers: initiated.upload.headers,
  body: browserFile,
});

const detail = (await api.post(`/uploaded-file/${initiated.id}/complete`)).data;
```

Trusted backend code dùng cùng final lifecycle. `ownerId` lấy từ request/job context đã xác minh,
không lấy từ caller JSON:

```ts
const publicCover = await files.upload(pngBuffer, 'cover.png', { module: 'cms', type: 'cover' }, ownerId, {
  contentType: 'image/png',
  visibility: 'public',
  disposition: 'inline',
});

const temporary = await files.uploadTemporary(pngBuffer, 'preview.png', { module: 'cms' }, ownerId, {
  contentType: 'image/png',
});
// temporary.expiredAt is exactly temporary.completedAt + 24 elapsed hours.
```

## Hành vi khi thất bại {#failure-behavior}

Upload theo cơ chế pending-first: hàng cơ sở dữ liệu được lưu ở trạng thái ẩn, sau đó byte được ghi,
rồi đúng hàng đó được activation. Ghi/activation thất bại không để lại hàng hiển thị và giữ một
cleanup claim bền vững nếu cleanup tức thời cũng thất bại.

Quá trình xóa đánh dấu hàng là pending trước khi xóa object và xóa mềm. Pending job cấu hình được
retry pending/staging/outbox và có thể purge row legacy chưa dùng; temporary job riêng xóa file ready
sau TTL cố định 24 giờ. `jobScheduler: {}` thêm distributed lock, còn CAS/outbox ở row vẫn bảo vệ
các instance chạy đồng thời.

Không gọi `unsafeSystemRetryPendingDeletions()` hoặc `unsafeSystemPurgeUnusedBefore()` từ HTTP
controller. Theo thiết kế, chúng đi qua mọi tenant và chỉ thuộc về maintenance worker được phân
quyền riêng.

## Remote clone {#remote-cloning}

Nếu ứng dụng cần remote clone, hãy bật nó với allowlist host chính xác và size có giới hạn:

```ts
remoteClone: {
  enabled: true,
  allowedHosts: ['assets.example.com'],
  maxBytes: 8 * 1024 * 1024,
  maxRedirects: 2,
  timeoutMs: 5_000,
},
```

Fragment này thuộc cấu hình `uploadedFile`. Mỗi redirect đều được validation lại; đích private,
loopback, link-local, reserved và các đích không public khác đều bị từ chối.
