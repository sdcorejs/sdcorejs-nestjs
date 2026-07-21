# Uploaded files

This example uses private S3 objects, mounts the built-in authenticated controller, and attaches
uploaded references to an order.

## Configure S3 and cleanup

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

The S3 driver uses `@aws-sdk/client-s3` v3. This configuration omits explicit credentials and uses
the standard AWS credential-provider chain. If you set `accessId` or `accessKey`, both are
required. `autoLoadEntities` registers `UploadedFile` and `JobScheduler`; generate migrations.
The verified token must expose a UUID `sub` plus `tenant` (the default principal resolver maps
both); configure a custom principal resolver when your claim names differ.

The controller is private/opt-in: it is exposed only because it appears in `controllers`. It adds
`AuthGuard` and provides:

- `POST /uploaded-file` (multipart field `file`) → HTTP 201;
- `GET /uploaded-file/:id/download` → HTTP 200 attachment.

## Upload and attach

The upload response includes an immutable `key` and a private `cdn` download reference. Store one
of those exact references in the order payload, then mark it used:

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

`orderId` and every file ID must be UUIDs. Reference batches are all-or-nothing, deduplicated, and
capped at 100. Missing, malformed, cross-tenant, and denied references are not distinguished.
`OrderAccessPolicy` represents application-owned loading and authorization of the target order in
the current tenant; file provenance metadata never grants access to that domain resource.

## Direct service upload

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

Authorize and load the referenced order before both calls. The `module`, `entity`, `entityId`, and
`type` fields are audit/provenance metadata only; `UploadedFileService` does not infer order or
invoice permissions from them.

This focused fragment assumes injected `files: UploadedFileService`, application
`pdfBuffer: Buffer`, and UUID `orderId`.

## Failure behavior

Upload is pending-first: the database row is saved hidden, then bytes are written, then the exact
row is activated. A failed write/activation leaves no visible row and retains a durable cleanup
claim if immediate cleanup also fails.

Deletion marks rows pending before object removal and soft deletion. The daily 03:00 job retries
eligible pending claims and purges unused files older than seven days. `jobScheduler: {}` ensures
one sweep wins across application instances.

Do not call `unsafeSystemRetryPendingDeletions()` or `unsafeSystemPurgeUnusedBefore()` from an HTTP
controller. They cross every tenant by design and belong only in a separately authorized maintenance
worker.

## Remote cloning

If the application needs remote clone, enable it with an exact host allowlist and bounded size:

```ts
remoteClone: {
  enabled: true,
  allowedHosts: ['assets.example.com'],
  maxBytes: 8 * 1024 * 1024,
  maxRedirects: 2,
  timeoutMs: 5_000,
},
```

This fragment belongs in `uploadedFile` configuration. Every redirect is revalidated; private,
loopback, link-local, reserved, and other non-public destinations are rejected.
