# Validation API

Import path: `@sdcorejs/nestjs/validation`

The validation entrypoint integrates Zod 4 with Nest guards and the library's stable error envelope.

## Exports

| Export | Kind | Purpose |
| --- | --- | --- |
| `parseZod` | function | Directly parse/coerce a payload or throw a standard 400 |
| `ZodSource` | type | `'body' \| 'query' \| 'params'` |
| `ZodIssueDetail` | interface | Safe issue path, message, code and interpolation params |
| `ZodSchemaMap` | type | Partial map of request sources to Zod schemas |
| `ZodValidationGuard` | function | Nest guard factory for one or several request sources |
| `zPageNumber` | schema | Coerced non-negative integer, default `0` |
| `zPageSize` | schema | Coerced integer `1..200`, default `10` |
| `zPaging` | schema | `{ pageNumber, pageSize }` preset |
| `zUuid` | function | UUID string schema with configurable message code |
| `zUuidV4` | function | RFC-variant UUID v4 string schema with configurable message code |
| `zBool` | schema | Coerces `true`, `1`, `yes` strings to true; other strings to false |

Runtime validation uses the required `zod` version 4 dependency.

## Direct parsing

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

Failure throws `BadRequestException` with:

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

Only JSON-safe primitive/primitive-array issue fields are copied into `params`; regexes, functions
and object values are dropped.

## Request guard

Single source:

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

Multiple sources are validated as one operation:

```ts
const IdParams = z.object({ id: zUuid() });

@UseGuards(
  AuthGuard,
  ZodValidationGuard({ params: IdParams, body: CreateProduct }),
)
@Put(':id')
update() {}
```

The guard collects issues from every configured source and mutates no input unless all sources pass.
On success it replaces `body`; Express 5 getter-only `query` and `params` objects are updated in
place. Put `AuthGuard` first so unauthenticated clients do not receive validation details.

## Pagination preset

```ts
const query = zPaging.parse({ pageNumber: '0', pageSize: '200' });
// { pageNumber: 0, pageSize: 200 }
```

Pages are **zero-based** and `200` is the maximum, matching `BaseRepository`. `zPageSize` rejects
values above 200; direct calls to `BaseRepository.paging` clamp them to 200.

## i18n integration

Use stable translation keys as schema messages. `SdI18nExceptionFilter` localizes the top-level
error and each `issues[].message`, passing `params` as interpolation data. See [i18n](./i18n.md).
