import { BadRequestException, type CanActivate, type ExecutionContext, Injectable, type Type } from '@nestjs/common';
import type { ZodTypeAny } from 'zod';
import { apiError } from '../orm/types/api-response.types';
import { toIssues, type ZodSource } from './zod.utils';

interface MutableRequest {
  body?: unknown;
  query?: Record<string, unknown>;
  params?: Record<string, unknown>;
}

/**
 * Factory producing a guard that validates `request[source]` against a Zod schema.
 * On success, the parsed (coerced) value replaces the raw input. On failure throws
 * `BadRequestException` with `apiError('core.validation.failed', …, { issues })`.
 *
 * Guard order: place AFTER `AuthGuard` — `@UseGuards(AuthGuard, ZodValidationGuard(schema))`
 * so unauthenticated requests never reach validation (no info leak).
 *
 * @example
 * @UseGuards(AuthGuard, ZodValidationGuard(CreateProductSchema))
 * @Post()
 * create(@Body() dto: CreateProductDto) {}
 */
export const ZodValidationGuard = (schema: ZodTypeAny, source: ZodSource = 'body'): Type<CanActivate> => {
  @Injectable()
  class ZodGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
      const req = context.switchToHttp().getRequest<MutableRequest>();
      const payload = source === 'body' ? req.body : source === 'params' ? req.params : req.query;

      const parsed = schema.safeParse(payload);
      if (!parsed.success) {
        throw new BadRequestException(
          apiError('core.validation.failed', 'Validation failed', { issues: toIssues(parsed.error, source) }),
        );
      }

      // Replace raw input with coerced data. `body` is freely reassignable; `query`/`params`
      // are getter-only under Express 5, so mutate in place there.
      if (source === 'body') {
        req.body = parsed.data;
      } else {
        const target = source === 'params' ? req.params : req.query;
        if (target) {
          for (const key of Object.keys(target)) delete target[key];
          Object.assign(target, parsed.data);
        }
      }
      return true;
    }
  }

  return ZodGuard;
};
