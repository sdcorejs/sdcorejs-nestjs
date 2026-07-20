# CRUD có scope tenant {#tenant-scoped-crud}

Công thức này tiếp tục dùng `Product`, `ProductDto` và `ProductService` đã định nghĩa trong
[ứng dụng hoàn chỉnh](/vi/examples/complete-app). Đây là class của ứng dụng, không phải export của
thư viện. Controller bên dưới khai báo rõ mọi mutation thay vì expose một API generic không giới hạn.

## Controller đã validation {#validated-controller}

```ts
import {
  Body,
  Controller,
  Delete,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard, HasPermission } from '@sdcorejs/nestjs/auth';
import {
  ApiResponse,
  type PagingReq,
} from '@sdcorejs/nestjs/core';
import {
  ZodValidationGuard,
  zPaging,
  zUuid,
} from '@sdcorejs/nestjs/validation';
import { z } from 'zod';
import { Product } from './product.entity';
import { ProductService } from './product.data';

const ProductParams = z.object({ id: zUuid() });
const CreateProduct = z.object({
  sku: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(256),
  isActive: z.boolean().default(true),
});
const UpdateProduct = CreateProduct.partial();

@Controller('products')
@UseGuards(AuthGuard)
export class ProductCrudController {
  constructor(private readonly products: ProductService) {}

  @Post('paging')
  @HasPermission('product:read')
  @UseGuards(ZodValidationGuard(zPaging))
  async paging(@Body() request: PagingReq<Product>) {
    return ApiResponse.ok(await this.products.paging(request));
  }

  @Post()
  @HasPermission('product:create')
  @UseGuards(ZodValidationGuard(CreateProduct))
  async create(@Body() body: z.infer<typeof CreateProduct>) {
    return ApiResponse.ok(this.products.mapDTO(await this.products.create(body)));
  }

  @Patch(':id')
  @HasPermission('product:update')
  @UseGuards(
    ZodValidationGuard({ params: ProductParams, body: UpdateProduct }),
  )
  async update(
    @Param('id') id: string,
    @Body() body: z.infer<typeof UpdateProduct>,
  ) {
    return ApiResponse.ok(this.products.mapDTO(await this.products.update(id, body)));
  }

  @Delete(':id')
  @HasPermission('product:delete')
  @UseGuards(ZodValidationGuard(ProductParams, 'params'))
  async softDelete(@Param('id') id: string) {
    await this.products.softDelete(id);
    return ApiResponse.noContent();
  }

  @Post(':id/restore')
  @HasPermission('product:restore')
  @UseGuards(ZodValidationGuard(ProductParams, 'params'))
  async restore(@Param('id') id: string) {
    return ApiResponse.ok(await this.products.restore(id));
  }
}
```

Vì `AuthGuard` ở cấp class nên nó chạy trước method guard; Zod guard sau đó validation và coerce
input. Schema create/update chủ đích không chứa `tenantCode`. `BaseRepository` điền scope từ context
đáng tin cậy và từ chối nỗ lực chuyển hàng hiện có sang scope khác.

## Hợp đồng paging {#paging-contract}

```json
{
  "pageNumber": 0,
  "pageSize": 20
}
```

Controller này chấp nhận shape `zPaging` tối thiểu. Nếu ứng dụng expose filter, field hoặc sort, hãy
định nghĩa schema Zod theo domain với tổ hợp field/operator trong allowlist thay vì chấp nhận input
giống SQL tùy ý.

## Status thực tế {#actual-statuses}

Khi không khai báo `@HttpCode`, Nest trả về:

| Thao tác | Status | Body |
| --- | --- | --- |
| POST paging | 201 | `{ data: { items, total } }` |
| POST create | 201 | `{ data: ProductDto }` |
| PATCH update | 200 | `{ data: ProductDto }` |
| DELETE soft-delete | 200 | `{ data: null }` |
| POST restore | 201 | `{ data: ProductDto[] }` |

`ApiResponse.noContent()` là helper envelope, không phải decorator HTTP status.

## Xác minh khả năng cô lập {#verify-isolation}

Seed cùng SKU trong tenant ACME và BETA, sau đó assert:

1. Paging ACME chỉ trả về hàng ACME.
2. Detail/update/delete của ACME với UUID thuộc BETA có hành vi như không tìm thấy.
3. Body create chứa field tenant xung đột bị từ chối hoặc bỏ qua tại ranh giới DTO đã validation
   trước khi scope repository được áp dụng.
4. Trang `0` là trang đầu tiên và giá trị trên 200 không thể trả về quá 200 hàng.

Xem [Kiểm thử](/vi/examples/testing) để tham khảo cấu trúc E2E.
