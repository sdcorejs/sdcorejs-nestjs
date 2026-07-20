# Validation with Zod v4

The validation entry point supports Zod v4. A guard validates body, query, and/or params, then
replaces raw values with parsed/coerced output only after every selected source succeeds.

## One source

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

Place `AuthGuard` first so unauthenticated requests do not receive validation details.

## Multiple sources

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

Issues from every failing source are merged. Query and params are mutated in place for Express 5;
the body is reassigned. No source is changed when any selected schema fails.

## Presets

| Export | Behavior |
| --- | --- |
| `zPageNumber` | coerced integer, minimum 0, default 0 |
| `zPageSize` | coerced integer 1–200, default 10 |
| `zPaging` | object containing both fields |
| `zUuid(message?)` | UUID validation using the repository's UUID helper |
| `zBool` | `true`, `1`, or `yes` becomes true; other strings become false |

Pages are 0-based. The maximum of 200 matches `BaseRepository`.

## Direct parsing

```ts
import { parseZod } from '@sdcorejs/nestjs/validation';
import { z } from 'zod';

const MessageSchema = z.object({ event: z.string(), retry: z.coerce.number() });
const incomingMessage: unknown = { event: 'order.created', retry: '2' };
const message = parseZod(MessageSchema, incomingMessage, 'body');
```

On failure, both APIs throw `BadRequestException` with code `core.validation.failed` and an
`issues` array. Each issue has a source-prefixed path, Zod code, message, and safe interpolation
params. Put stable i18n codes in schema messages; the i18n filter translates both the top-level
message and individual issue messages.
