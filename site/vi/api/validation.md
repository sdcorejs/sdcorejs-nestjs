# API validation {#validation-api}

Đường dẫn import: `@sdcorejs/nestjs/validation`

Entrypoint validation tích hợp Zod 4 với Nest guard và error envelope ổn định của thư viện.

## Các export {#exports}

| Export | Loại | Mục đích |
| --- | --- | --- |
| `parseZod` | function | Parse/coerce trực tiếp payload hoặc ném lỗi 400 chuẩn |
| `ZodSource` | type | `'body' \| 'query' \| 'params'` |
| `ZodIssueDetail` | interface | Đường dẫn issue an toàn, message, code và tham số nội suy |
| `ZodSchemaMap` | type | Ánh xạ một phần từ nguồn request sang Zod schema |
| `ZodValidationGuard` | function | Factory Nest guard cho một hoặc nhiều nguồn request |
| `zPageNumber` | schema | Số nguyên không âm đã coerce, mặc định `0` |
| `zPageSize` | schema | Số nguyên đã coerce trong khoảng `1..200`, mặc định `10` |
| `zPaging` | schema | Preset `{ pageNumber, pageSize }` |
| `zUuid` | function | Schema chuỗi UUID với message code có thể cấu hình |
| `zUuidV4` | function | Schema chuỗi UUID v4 đúng RFC với message code có thể cấu hình |
| `zBool` | schema | Coerce chuỗi `true`, `1`, `yes` thành true; chuỗi khác thành false |

Validation runtime dùng dependency bắt buộc `zod` phiên bản 4.

## Parse trực tiếp {#direct-parsing}

```ts
import { z } from 'zod';
import { parseZod } from '@sdcorejs/nestjs/validation';

const CreateProduct = z.object({
  name: z.string().min(1, 'catalog.product.name.required'),
  price: z.coerce.number().nonnegative('catalog.product.price.min'),
});

const value = parseZod(CreateProduct, payload, 'body');
// value is typed and contains Zod coercions/transforms
```

Khi thất bại, `BadRequestException` được ném với nội dung:

```json
{
  "code": "core.validation.failed",
  "message": "Validation failed",
  "data": {
    "issues": [
      {
        "path": "name",
        "message": "catalog.product.name.required",
        "code": "too_small",
        "params": { "minimum": 1 }
      }
    ]
  }
}
```

Chỉ các trường issue là primitive/mảng primitive an toàn với JSON được sao chép vào `params`;
regex, function và giá trị object bị loại bỏ.

## Request guard {#request-guard}

Một nguồn:

```ts
@UseGuards(AuthGuard, ZodValidationGuard(CreateProduct))
@Post()
create(@Body() body: z.infer<typeof CreateProduct>) {}
```

```ts
@UseGuards(AuthGuard, ZodValidationGuard(zPaging, 'query'))
@Get()
list(@Query() query: z.infer<typeof zPaging>) {}
```

Nhiều nguồn được validation như một thao tác duy nhất:

```ts
const IdParams = z.object({ id: zUuid() });

@UseGuards(
  AuthGuard,
  ZodValidationGuard({ params: IdParams, body: CreateProduct }),
)
@Put(':id')
update() {}
```

Guard thu thập issue từ mọi nguồn đã cấu hình và không thay đổi đầu vào trừ khi tất cả nguồn đều
pass. Khi thành công, nó thay thế `body`; object `query` và `params` chỉ có getter của Express 5
được cập nhật tại chỗ. Đặt `AuthGuard` trước để client chưa xác thực không nhận được chi tiết
validation.

## Preset phân trang {#pagination-preset}

```ts
const query = zPaging.parse({ pageNumber: '0', pageSize: '200' });
// { pageNumber: 0, pageSize: 200 }
```

Trang bắt đầu từ **0** và `200` là mức tối đa, đồng nhất với `BaseRepository`. `zPageSize` từ chối
giá trị lớn hơn 200; lời gọi trực tiếp tới `BaseRepository.paging` sẽ giới hạn chúng về 200.

## Tích hợp i18n {#i18n-integration}

Dùng translation key ổn định làm message của schema. `SdI18nExceptionFilter` bản địa hóa lỗi cấp
cao nhất và từng `issues[].message`, đồng thời truyền `params` làm dữ liệu nội suy. Xem
[i18n](./i18n.md).
