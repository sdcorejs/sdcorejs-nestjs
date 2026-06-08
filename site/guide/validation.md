# Validation (Zod v4)

::: warning Zod v4 only
Requires `zod@^4`. Zod v3 is not supported (the issue shape differs).
:::

`ZodValidationGuard` validates `request[source]` and replaces the raw input with the coerced value. Set
each field's message to an i18n **code** — the [i18n layer](/guide/i18n) localizes it.

```ts
import { z } from 'zod';
import { UseGuards } from '@nestjs/common';
import { AuthGuard } from '@sdcorejs/nestjs/auth';
import { ZodValidationGuard, zPaging } from '@sdcorejs/nestjs/validation';

const CreateProduct = z.object({
  name: z.string().min(3, 'core.product.name.min'),
  price: z.coerce.number().positive('core.product.price.positive'),
});

// single source
@UseGuards(AuthGuard, ZodValidationGuard(CreateProduct))
@Post() create(@Body() dto: z.infer<typeof CreateProduct>) {}

// multiple sources at once — issues from every part merge into one envelope
@UseGuards(AuthGuard, ZodValidationGuard({ body: CreateProduct, query: zPaging }))
@Post('search') search() {}
```

- **Guard order** — place AFTER `AuthGuard` so unauthenticated requests never reach validation.
- **Query presets** (params arrive as strings): `zPaging` (`{ pageNumber, pageSize }` matching
  `BaseRepository` caps), `zUuid(msgCode?)`, `zBool` (`'true'`/`'1'`/`'yes'` → `true`).
- **Issue params** — each `ZodIssueDetail` carries `{ path, message, code, params? }`. `params` holds
  JSON-safe interpolation vars (`minimum`, `maximum`, `format`, `expected`, …) so the i18n layer can
  render "must be at least {minimum}".
- Failures throw `BadRequestException(apiError('core.validation.failed', …, { issues }))`.

::: info Express 5
`query` / `params` are getter-only, so the guard mutates them in place; `body` is reassigned.
:::
