# Validation với Zod v4 {#validation-with-zod-v4}

Entry point validation hỗ trợ Zod v4. Một guard validate body, query và/hoặc params, sau đó
thay giá trị thô bằng output đã parse/coerce chỉ sau khi mọi nguồn được chọn đều thành công.

## Một nguồn {#one-source}

```ts
import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@sdcorejs/nestjs/auth';
import { ZodValidationGuard } from '@sdcorejs/nestjs/validation';
import { z } from 'zod';

const CreateProductSchema = z.object({
  sku: z.string().min(1, 'app.product.sku.required'),
  price: z.coerce.number().positive('app.product.price.positive'),
});

type CreateProduct = z.infer<typeof CreateProductSchema>;

@Controller('products')
class ProductCommandController {
  @Post()
  @UseGuards(AuthGuard, ZodValidationGuard(CreateProductSchema))
  create(@Body() body: CreateProduct) {
    return body;
  }
}
```

Đặt `AuthGuard` trước để request chưa xác thực không nhận được chi tiết validation.

## Nhiều nguồn {#multiple-sources}

```ts
import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@sdcorejs/nestjs/auth';
import {
  ZodValidationGuard,
  zPaging,
  zUuid,
} from '@sdcorejs/nestjs/validation';
import { z } from 'zod';

const ParamsSchema = z.object({ id: zUuid() });
const QuerySchema = zPaging.extend({
  includeInactive: z.enum(['true', 'false']).default('false'),
});

@Controller('products')
class ProductQueryController {
  @Get(':id')
  @UseGuards(
    AuthGuard,
    ZodValidationGuard({ params: ParamsSchema, query: QuerySchema }),
  )
  detail(
    @Param() params: z.infer<typeof ParamsSchema>,
    @Query() query: z.infer<typeof QuerySchema>,
  ) {
    return { params, query };
  }
}
```

Issue từ mọi nguồn thất bại được merge. Query và params được thay đổi tại chỗ cho Express 5;
body được gán lại. Không nguồn nào bị thay đổi khi bất kỳ schema đã chọn nào thất bại.

## Preset {#presets}

| Export | Hành vi |
| --- | --- |
| `zPageNumber` | số nguyên được coerce, tối thiểu 0, mặc định 0 |
| `zPageSize` | số nguyên được coerce 1–200, mặc định 10 |
| `zPaging` | object chứa cả hai trường |
| `zUuid(message?)` | validation UUID bằng helper UUID của repository |
| `zBool` | `true`, `1` hoặc `yes` trở thành true; chuỗi khác trở thành false |

Trang được đánh số từ 0. Mức tối đa 200 khớp với `BaseRepository`.

## Parse trực tiếp {#direct-parsing}

```ts
import { parseZod } from '@sdcorejs/nestjs/validation';
import { z } from 'zod';

const MessageSchema = z.object({ event: z.string(), retry: z.coerce.number() });
const incomingMessage: unknown = { event: 'order.created', retry: '2' };
const message = parseZod(MessageSchema, incomingMessage, 'body');
```

Khi thất bại, cả hai API đều ném `BadRequestException` với code `core.validation.failed` và mảng
`issues`. Mỗi issue có path được thêm prefix nguồn, Zod code, message và params nội suy an toàn.
Đặt i18n code ổn định trong message của schema; i18n filter dịch cả message cấp cao nhất
lẫn từng issue message.
