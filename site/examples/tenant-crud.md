# Tenant-scoped CRUD

This recipe continues the `Product`, `ProductDto`, and `ProductService` defined in the
[complete application](/examples/complete-app). Those are application classes, not library exports.
The controller below makes every mutation explicit instead of exposing an unbounded generic API.

## Validated controller

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

Because `AuthGuard` is class-level, it runs before method guards; the Zod guard then validates and
coerces input. The create/update schemas deliberately contain no `tenantCode`. `BaseRepository`
fills scope from trusted context and rejects attempts to move an existing row to another scope.

## Paging contract

```json
{
  "pageNumber": 0,
  "pageSize": 20
}
```

This controller accepts the minimal `zPaging` shape. If your application exposes filters, fields,
or sorts, define a domain-specific Zod schema with allowlisted field/operator combinations rather
than accepting arbitrary SQL-like input.

## Actual statuses

Without explicit `@HttpCode`, Nest returns:

| Operation | Status | Body |
| --- | --- | --- |
| POST paging | 201 | `{ data: { items, total } }` |
| POST create | 201 | `{ data: ProductDto }` |
| PATCH update | 200 | `{ data: ProductDto }` |
| DELETE soft-delete | 200 | `{ data: null }` |
| POST restore | 201 | `{ data: ProductDto[] }` |

`ApiResponse.noContent()` is an envelope helper, not an HTTP status decorator.

## Verify isolation

Seed the same SKU in tenants ACME and BETA, then assert:

1. ACME paging returns only ACME rows.
2. ACME detail/update/delete of a BETA UUID behaves as not found.
3. a create body containing a conflicting tenant field is rejected or ignored by the validated DTO
   boundary before repository scope is applied.
4. page `0` is the first page and values above 200 cannot return more than 200 rows.

See [Testing](/examples/testing) for an E2E structure.
