import { z } from 'zod';
import { ValidationUtilities } from '@sdcorejs/utils/fns';

const { isUuid } = ValidationUtilities;

/**
 * Zod presets for query-string validation. Query params arrive as strings, so these coerce
 * before validating. Pair with `ZodValidationGuard(schema, 'query')`.
 */

/** Coerce a query string to a non-negative integer page number. Default `0`. */
export const zPageNumber = z.coerce.number().int().min(0, 'core.validation.page-number.min').default(0);

/** Coerce a query string to a page size in `[1, 1000]`. Default `10`. Matches `BaseRepository` caps. */
export const zPageSize = z.coerce
  .number()
  .int()
  .min(1, 'core.validation.page-size.min')
  .max(1000, 'core.validation.page-size.max')
  .default(10);

/** Paging query preset matching `PagingReq` `pageNumber` / `pageSize`. */
export const zPaging = z.object({ pageNumber: zPageNumber, pageSize: zPageSize });

/** UUID string validator (uses the same `isUuid` helper as `BaseRepository`). */
export const zUuid = (message = 'core.validation.uuid'): z.ZodString =>
  z.string().refine(isUuid, { message }) as unknown as z.ZodString;

/** Coerce `'true'`/`'1'`/`'yes'` (case-insensitive) to `true`, anything else string → `false`. */
export const zBool = z.preprocess(
  (v) => (typeof v === 'string' ? ['true', '1', 'yes'].includes(v.toLowerCase()) : v),
  z.boolean(),
);
