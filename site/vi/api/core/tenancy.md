# API multi-tenancy {#multi-tenancy-api}

Đường dẫn import: `@sdcorejs/nestjs/core`

Tenancy được điều khiển bằng metadata và strategy. Mọi thuộc tính entity được trang trí bằng
`@Scoped()` trở thành boundary query/write bắt buộc do `BaseRepository` thực thi. Entity không có
scope không thay đổi.

## Các export {#exports}

| Export | Loại | Mục đích |
| --- | --- | --- |
| `ITenancyStrategy` | interface | Phân giải scope và grant đặc quyền tùy chọn |
| `TenancyOperation` | type | `read`, `create`, `import`, `update`, `delete`, `soft-delete`, `restore` |
| `TENANCY_OPERATIONS` | readonly tuple | Allowlist thao tác runtime đầy đủ |
| `TenancyBypassGrant`, `TenancyBypassAuditEvent` | interface | Truy cập đặc quyền có giới hạn và audit event |
| `TenancyCallbacks` | interface | Callback `resolve`, `bypass` đã deprecated và `bypassGrant` inline |
| `DefaultTenancyStrategy` | class | Mặc định scope rỗng, không bao giờ bypass |
| `CallbackTenancyStrategy` | class | Chuyển callback thành `ITenancyStrategy` |
| `TenancyModule`, `TenancyModuleOptions` | class/type | Module đăng ký strategy |
| `TENANCY_STRATEGY` | value | DI token |
| `buildScopeFilters` | function | Dựng predicate `Filter[]` |
| `buildScopeWhere` | function | Dựng predicate criteria TypeORM |
| `applyScopeToEntity` | function | Validation và áp dụng write scope |
| `RegisteredTenancy` | interface | Binding strategy/context toàn process |
| `registerTenancy`, `getTenancy` | function | API registry toàn process |
| `TenancyError` | class | Lỗi tenancy cơ sở có code |
| `MissingTenancyContextError` | class | Entity có scope nhưng không có strategy |
| `MissingTenancyScopeError` | class | Thiếu chiều scope bắt buộc |
| `InvalidTenancyScopeError` | class | Giá trị scope không an toàn/không hợp lệ |
| `TenancyScopeMutationError` | class | Update cố di chuyển một hàng giữa các scope |
| `UnauthorizedTenancyBypassError` | class | Bypass grant vắng mặt, sai dạng hoặc chưa được cấp quyền |

Các export `Scoped`, `ScopedOptions`, `ScopedColumnMetadata`, `getScopedColumns` và
`getScopedColumnMetadata` được mô tả cùng [decorator ORM](./orm.md#entity-and-metadata-exports).

## Ví dụ strategy {#strategy-example}

```ts
import type { RequestContext } from '@sdcorejs/nestjs';
import {
  type ITenancyStrategy,
  TenancyModule,
  type TenancyBypassGrant,
} from '@sdcorejs/nestjs/core';

export class AppTenancyStrategy implements ITenancyStrategy {
  getCurrentScope(ctx: RequestContext): Record<string, unknown> {
    return {
      tenantCode: ctx.tenant,
      departmentCode: ctx.custom?.departmentCode,
    };
  }

  shouldBypass(): boolean {
    return false;
  }

  getBypassGrant(ctx: RequestContext): TenancyBypassGrant | undefined {
    if (!ctx.roles?.includes('platform-admin') || !ctx.userId) return undefined;
    return {
      authorized: true,
      actorId: ctx.userId,
      reason: 'approved cross-tenant support request',
      allowedTargets: ['public.product'],
      allowedOperations: ['read'],
      audit: (event) => privilegedAuditSink.writeSync(event),
    };
  }
}

TenancyModule.forRoot({ strategy: AppTenancyStrategy });
```

Các key của `getCurrentScope` là **tên thuộc tính** entity, không phải tên cột cơ sở dữ liệu. Scalar
trở thành `EQUAL`; mảng trở thành `IN`. Scope tùy chọn bị thiếu được bỏ qua. Scope bắt buộc không có
giá trị sẽ fail closed. Mảng giá trị cho phép rỗng không khớp hàng nào.

Đối với write, scalar scope ghi đè đầu vào caller. Khi có nhiều giá trị được phép, caller phải chọn
một trong số đó trên entity mới; một giá trị duy nhất được chọn tự động.

## Cấu hình inline {#inline-configuration}

```ts
TenancyModule.forRoot({
  resolve: (ctx) => ({ tenantCode: ctx.tenant }),
  global: true,
  registerGlobally: true,
});
```

`global` và `registerGlobally` đều mặc định là `true`. Lớp strategy được ưu tiên hơn callback inline.
Registry dùng một slot `Symbol.for` để repository được tải qua các package subpath khác nhau vẫn
quan sát cùng một binding.

## Bypass đặc quyền {#privileged-bypass}

Bypass grant phải có `authorized: true`, actor/reason không rỗng, ít nhất một
`EntityMetadata.tablePath` chính xác (hoặc `*`), ít nhất một thao tác hợp lệ và callback `audit`
đồng bộ. Callback phải trả `undefined`; promise/thenable sẽ fail closed vì repository không thể bảo
đảm audit bất đồng bộ hoàn tất trước khi phát SQL.

Luồng cũ `shouldBypass() === true` bị chủ ý từ chối. Giữ method để tương thích interface, nhưng trả
`false` và triển khai `getBypassGrant` cho các luồng đặc quyền đã review.

## Mã lỗi {#error-codes}

| Lỗi | `code` |
| --- | --- |
| `MissingTenancyContextError` | `TENANCY_CONTEXT_MISSING` |
| `MissingTenancyScopeError` | `TENANCY_SCOPE_MISSING` |
| `InvalidTenancyScopeError` | `TENANCY_SCOPE_INVALID` |
| `TenancyScopeMutationError` | `TENANCY_SCOPE_IMMUTABLE` |
| `UnauthorizedTenancyBypassError` | `TENANCY_BYPASS_UNAUTHORIZED` |

Đây là lỗi ứng dụng thay vì HTTP envelope tự động. Hãy ánh xạ chúng tại boundary của bạn mà không
tiết lộ sự tồn tại của resource cross-tenant.
