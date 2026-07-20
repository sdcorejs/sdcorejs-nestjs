# Cài đặt {#installation}

## Yêu cầu {#requirements}

- Node.js 20 trở lên.
- NestJS 11 (`@nestjs/common` và `@nestjs/core` là peer dependency).
- TypeScript decorator và `reflect-metadata`, theo yêu cầu của NestJS và TypeORM.
- PostgreSQL cho toàn bộ bề mặt ORM và tính năng có trạng thái. Xem
  [Cơ sở dữ liệu và PostgreSQL](/vi/guide/database) để biết các ranh giới chính xác.

Cài đặt package:

```bash
npm install @sdcorejs/nestjs
```

Package cài đặt các runtime dependency, bao gồm TypeORM, Passport, BullMQ, Axios, Zod v4
và các package tích hợp NestJS. Những dependency sau là tùy chọn khi chạy và chỉ
cần thiết khi bạn bật tính năng tương ứng:

```bash
# Redis cache
npm install ioredis

# Keycloak/OIDC JWKS verification
npm install jwks-rsa jsonwebtoken

# S3 uploaded-file driver (AWS SDK v3)
npm install @aws-sdk/client-s3
```

Package hiện tại khai báo chúng là optional dependency, vì vậy quá trình cài npm thông thường thường
sẽ cài chúng. Liệt kê tường minh trong ứng dụng giúp yêu cầu runtime dễ nhận thấy và
cho phép lockfile của bạn kiểm soát phiên bản của chúng.

## Thiết lập TypeScript {#typescript-setup}

Dùng các thiết lập decorator tiêu chuẩn của NestJS:

```json
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "strict": true
  }
}
```

Import `reflect-metadata` một lần khi tiến trình khởi động nếu bootstrap chưa thực hiện:

```ts
import 'reflect-metadata';
```

## Xác minh cài đặt {#verify-the-installation}

Trước tiên, tạo module tối thiểu:

```ts
import { Module } from '@nestjs/common';
import { SdCoreModule } from '@sdcorejs/nestjs';

@Module({
  imports: [SdCoreModule.forRoot()],
})
export class AppModule {}
```

Thao tác này bật các module context, tenancy, audit, permission, cache và HTTP luôn hoạt động. Hành vi
nhạy cảm về bảo mật vẫn fail-closed: entity có phạm vi cần tenancy strategy, `AuthGuard` cần
Passport `jwt` strategy và `InternalGuard` cần secret provider.

## Nâng cấp phiên bản {#version-upgrades}

Pin khoảng phiên bản theo policy triển khai của bạn và đọc cả `CHANGELOG.md` lẫn
hướng dẫn migration theo phiên bản trước khi nâng cấp. Phiên bản 1.1.0 chủ động siết chặt một số mặc định bảo mật,
vì vậy ứng dụng hiện có cần làm theo hướng dẫn migration 1.1.0.
