import { BadRequestException, type CanActivate, type ExecutionContext, Injectable, type Type } from '@nestjs/common';
import type { ZodTypeAny } from 'zod';
import { apiError } from '../core/orm/types/api-response.types';
import { toIssues, type ZodIssueDetail, type ZodSource } from './zod.utils';

interface MutableRequest {
  body?: unknown;
  query?: Record<string, unknown>;
  params?: Record<string, unknown>;
}

/** Map form: validate several request parts in one guard. Omit a key to skip that source. */
export type ZodSchemaMap = Partial<Record<ZodSource, ZodTypeAny>>;

const isSchema = (v: ZodTypeAny | ZodSchemaMap): v is ZodTypeAny => typeof (v as ZodTypeAny).safeParse === 'function';

const readSource = (req: MutableRequest, source: ZodSource): unknown =>
  source === 'body' ? req.body : source === 'params' ? req.params : req.query;

/** Replace raw input with coerced data. `body` is reassignable; `query`/`params` are getter-only
 * under Express 5, so mutate in place there. */
const writeSource = (req: MutableRequest, source: ZodSource, data: unknown): void => {
  if (source === 'body') {
    req.body = data;
    return;
  }
  const target = source === 'params' ? req.params : req.query;
  if (target) {
    for (const key of Object.keys(target)) delete target[key];
    Object.assign(target, data as Record<string, unknown>);
  }
};

/**
 * Factory producing a guard that validates request data against Zod schema(s).
 *
 * Single source:
 *   `ZodValidationGuard(schema)` / `ZodValidationGuard(schema, 'query')`
 * Multiple sources (validated together, issues merged into one envelope):
 *   `ZodValidationGuard({ body: BodySchema, query: QuerySchema })`
 *
 * On success the parsed (coerced) value replaces each raw input. On failure throws
 * `BadRequestException` with `apiError('core.validation.failed', …, { issues })`, where each issue
 * carries its source-prefixed `path` so the consumer can tell body from query errors.
 *
 * Guard order: place AFTER `AuthGuard` — `@UseGuards(AuthGuard, ZodValidationGuard(schema))`
 * so unauthenticated requests never reach validation (no info leak).
 *
 * @example
 * @UseGuards(AuthGuard, ZodValidationGuard({ body: CreateProductSchema, query: ListQuerySchema }))
 */
export const ZodValidationGuard = (schemaOrMap: ZodTypeAny | ZodSchemaMap, source: ZodSource = 'body'): Type<CanActivate> => {
  const map: ZodSchemaMap = isSchema(schemaOrMap) ? { [source]: schemaOrMap } : schemaOrMap;
  const entries = Object.entries(map) as [ZodSource, ZodTypeAny][];

  @Injectable()
  class ZodGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
      const req = context.switchToHttp().getRequest<MutableRequest>();
      const issues: ZodIssueDetail[] = [];
      const coerced: [ZodSource, unknown][] = [];

      for (const [src, schema] of entries) {
        const parsed = schema.safeParse(readSource(req, src));
        if (parsed.success) {
          coerced.push([src, parsed.data]);
        } else {
          issues.push(...toIssues(parsed.error, src));
        }
      }

      if (issues.length) {
        throw new BadRequestException(apiError('core.validation.failed', 'Validation failed', { issues }));
      }

      // Only mutate after every source passed — no partial writes on failure.
      for (const [src, data] of coerced) writeSource(req, src, data);
      return true;
    }
  }

  return ZodGuard;
};
