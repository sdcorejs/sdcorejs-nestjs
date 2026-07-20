---
layout: home

hero:
  name: '@sdcorejs/nestjs'
  text: 'Các khối xây dựng NestJS an toàn'
  tagline: 'Phân vùng tenant TypeORM theo nguyên tắc từ chối mặc định, danh tính request đáng tin cậy, phân quyền, cô lập cache, HTTP đi, tệp, lịch sử, tác vụ, hàng đợi, validation và i18n — được phát hành qua tám entry point ổn định.'
  actions:
    - theme: brand
      text: Bắt đầu
      link: /vi/guide/getting-started
    - theme: alt
      text: Xem API
      link: /vi/api/
    - theme: alt
      text: Ví dụ hoàn chỉnh
      link: /vi/examples/

features:
  - title: Từ chối theo mặc định
    details: 'Repository có scope sẽ từ chối khi thiếu tenant, danh tính đáng tin cậy không bao giờ được lấy từ header tùy ý, quyền truy cập tệp mặc định chỉ dành cho chủ sở hữu và quyền đọc lịch sử mặc định là từ chối.'
  - title: Tài liệu dựa trên mã nguồn
    details: 'Mỗi entry point công khai đều có danh mục API, chữ ký, giá trị mặc định, lỗi, ranh giới bảo mật và ví dụ liên kết đến các hướng dẫn chuyên biệt.'
  - title: Vận hành hướng đến production
    details: 'Dọn dẹp tệp bền vững, job lease có fencing, khóa idempotency ổn định, cô lập namespace Redis, hướng dẫn migration PostgreSQL và các ranh giới không an toàn được nêu rõ.'
  - title: NestJS 11 · Node 20+
    details: 'Đầu ra ESM/CJS kép, declaration riêng cho từng định dạng, tính năng TypeORM dựa trên PostgreSQL và CI trên Node.js 20 lẫn 22.'
---

## Cài đặt {#install}

<p>
  <a href="https://www.npmjs.com/package/@sdcorejs/nestjs"><img src="https://img.shields.io/npm/v/@sdcorejs/nestjs.svg?logo=npm&color=crimson" alt="phiên bản npm" /></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/node/v/@sdcorejs/nestjs.svg?label=node" alt="hỗ trợ Node.js" /></a>
  <a href="https://github.com/sdcorejs/sdcorejs-nestjs/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/@sdcorejs/nestjs.svg" alt="giấy phép MIT" /></a>
  <a href="https://github.com/sdcorejs/sdcorejs-nestjs/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/sdcorejs/sdcorejs-nestjs/ci.yml?label=CI&logo=github" alt="trạng thái CI" /></a>
</p>

```bash
npm install @sdcorejs/nestjs
```

Các peer dependency duy nhất là `@nestjs/common ^11` và `@nestjs/core ^11`. Zod v4 được cài đặt làm
runtime bắt buộc vì validation thuộc root API; `ioredis`, `jwks-rsa`, `jsonwebtoken` và
`@aws-sdk/client-s3` vẫn là các runtime tùy chọn theo tính năng.
Hãy bắt đầu với phần [cài đặt](/vi/guide/installation), sau đó sao chép [ví dụ ứng dụng hoàn chỉnh](/vi/examples/complete-app).

## Chọn đúng entry point {#choose-the-right-entry-point}

| Import | Dùng cho |
| --- | --- |
| `@sdcorejs/nestjs` | `SdCoreModule`, các primitive context/bảo mật dùng chung, helper response và validation |
| `@sdcorejs/nestjs/core` | ORM, context, tenancy, audit |
| `@sdcorejs/nestjs/auth` | JWT/JWKS, permission, lời gọi nội bộ |
| `@sdcorejs/nestjs/services` | Cache và HTTP đi |
| `@sdcorejs/nestjs/validation` | Guard Zod v4 và preset query |
| `@sdcorejs/nestjs/queue` | Đăng ký BullMQ và lớp worker cơ sở |
| `@sdcorejs/nestjs/i18n` | Catalog, phân giải ngôn ngữ và envelope exception đã bản địa hóa |
| `@sdcorejs/nestjs/features` | Tệp đã tải lên, lịch sử thao tác, bộ lập lịch tác vụ phân tán |

Tám đường dẫn này là toàn bộ export map được hỗ trợ. Deep import được chủ đích không hỗ trợ.
Xem [tham chiếu entry point](/vi/reference/entry-points) và [danh mục API đầy đủ](/vi/api/).

## Những thay đổi trong 1.1.0 {#what-changed-in-1-1-0}

Phiên bản 1.1.0 tăng cường các ranh giới cơ sở dữ liệu và hạ tầng dùng chung: ánh xạ principal đáng
tin cậy, mutation có scope theo nguyên tắc từ chối mặc định, namespace cache, quyền sở hữu tệp đã
tải lên và dọn dẹp bền vững, phân quyền/ẩn dữ liệu lịch sử thao tác và job lease có fencing với khóa
idempotency ổn định. Phiên bản này yêu cầu Node.js 20 trở lên và một migration phối hợp rõ ràng cho
các ứng dụng hiện có.

[Đọc ghi chú phát hành](/vi/releases/1.1.0) · [Nâng cấp từ 1.0](/vi/migrations/1.0-to-1.1) ·
[Checklist bảo mật](/vi/reference/security)
