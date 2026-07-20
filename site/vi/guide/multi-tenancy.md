# Multi-tenancy {#multi-tenancy}

Tenancy được thực thi bởi `BaseRepository`. Thư viện không giả định tên cột: hãy đánh dấu từng chiều phạm vi
bằng `@Scoped()`, sau đó trả về các giá trị có khóa là tên thuộc tính tương ứng của entity.

## Định nghĩa entity có phạm vi {#define-a-scoped-entity}

```ts
import { Column, Entity } from 'typeorm';
import {
  BaseEntity,
  Scoped,
  SearchableFields,
  WithAudit,
} from '@sdcorejs/nestjs/core';

@SearchableFields({ exact: ['sku'], contain: ['name'], activeColumn: 'isActive' })
@Entity('product')
export class Product extends WithAudit(BaseEntity) {
  @Column({ length: 64 })
  @Scoped()
  tenantCode!: string;

  @Column({ length: 64, nullable: true })
  @Scoped({ required: false })
  departmentCode?: string;

  @Column({ length: 64 })
  sku!: string;

  @Column()
  name!: string;

  @Column({ default: true })
  isActive!: boolean;
}
```

`@Scoped()` mặc định là bắt buộc. Giá trị bắt buộc bị thiếu/null, chuỗi trống, ngày không hợp lệ hoặc
phạm vi không hợp lệ khác sẽ thất bại trước truy vấn. Mảng các giá trị được phép trở thành điều kiện `IN`; mảng
rỗng không khớp hàng nào. Chỉ dùng `required: false` cho một chiều chủ động để tùy chọn.

## Cấu hình phân giải phạm vi {#configure-scope-resolution}

Callback inline là đủ cho ứng dụng đơn giản:

```ts
import { SdCoreModule } from '@sdcorejs/nestjs';

SdCoreModule.forRoot({
  tenancy: {
    resolve: (context) => ({
      tenantCode: context.tenant,
      departmentCode: context.custom?.departmentCode,
    }),
  },
});
```

Với dependency được inject, hãy triển khai một strategy class:

```ts
import { Injectable } from '@nestjs/common';
import type {
  ITenancyStrategy,
  RequestContext,
  TenancyBypassGrant,
} from '@sdcorejs/nestjs/core';

@Injectable()
export class AppTenancyStrategy implements ITenancyStrategy {
  getCurrentScope(context: RequestContext): Record<string, unknown> {
    return {
      tenantCode: context.tenant,
      departmentCode: context.custom?.departmentCode,
    };
  }

  shouldBypass(): boolean {
    return false;
  }

  getBypassGrant(_context: RequestContext): TenancyBypassGrant | undefined {
    return undefined;
  }
}
```

Đăng ký bằng `tenancy: { strategy: AppTenancyStrategy }`.

## Các thao tác được thực thi {#enforced-operations}

Đối với entity có phạm vi, repository áp dụng cùng một phạm vi canonical cho:

- paging, deleted paging, all, search, detail và relation join;
- create và bulk import (phạm vi được điền từ context đáng tin cậy);
- update, hard delete, soft delete và restore; và
- tra cứu batch ID cùng xác minh số hàng bị ảnh hưởng.

Update thông thường không thể chuyển một hàng qua chiều phạm vi khác. Thay đổi có phạm vi bao gồm ID và phạm vi
trong SQL, đồng thời từ chối batch chỉ khớp một phần. Entity không có `@Scoped()` giữ hành vi TypeORM
thông thường.

## Grant bỏ qua đặc quyền {#privileged-bypass-grants}

Giá trị boolean bỏ qua không thể cấp quyền cho truy vấn không có phạm vi. Grant hợp lệ phải hẹp, có thể quy trách nhiệm và
được kiểm toán đồng bộ:

```ts
import type { TenancyBypassAuditEvent } from '@sdcorejs/nestjs/core';

function writePrivilegedAuditSynchronously(event: TenancyBypassAuditEvent): void {
  process.stdout.write(JSON.stringify(event) + '\n');
}

const tenancy = {
  resolve: (context: { tenant?: string }) => ({ tenantCode: context.tenant }),
  bypassGrant: (context: { userId?: string; roles?: string[] }) => {
    if (!context.userId || !context.roles?.includes('platform-admin')) return undefined;

    return {
      authorized: true as const,
      actorId: context.userId,
      reason: 'approved product export',
      allowedTargets: ['public.product'],
      allowedOperations: ['read'] as const,
      audit: writePrivilegedAuditSynchronously,
    };
  },
};
```

`public.product` chỉ là ví dụ. Thay thế nó bằng
`dataSource.getMetadata(Product).tablePath` trong cấu hình ứng dụng. Callback phải
hoàn tất đồng bộ và trả về `undefined`; callback async bị từ chối vì repository
không thể chứng minh nó đã hoàn thành trước khi phát SQL. Trong production, hãy ghi vào audit sink đồng bộ bền vững,
phù hợp với kiến trúc của bạn thay vì standard output.

## Truy cập TypeORM không an toàn {#unsafe-typeorm-access}

`unsafeRepository`, `unsafeGetRepository()` và `unsafeCreateQueryRunner()` chủ động bỏ qua
tenancy, mutation guard và kiểm tra số hàng bị ảnh hưởng. Tên của chúng là một ranh giới vận hành, không phải
API tiện ích. Chỉ dùng chúng trong mã bảo trì đã được review, có phân quyền và kiểm toán riêng.
