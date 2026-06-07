import { BadRequestException } from '@nestjs/common';
import type { z, ZodTypeAny } from 'zod';
import { apiError } from '../orm/types/api-response.types';

export type ZodSource = 'body' | 'query' | 'params';

export interface ZodIssueDetail {
  /** Dot-path of the offending field (or the source name when path empty). */
  path: string;
  /** Zod issue message — set this to an i18n code in your schema for the i18n layer. */
  message: string;
  /** Zod issue code (e.g. `invalid_type`, `too_small`). */
  code: string;
  /**
   * JSON-safe interpolation variables from the issue (e.g. `{ minimum: 3 }`, `{ format: 'email' }`,
   * `{ expected: 'string' }`). The i18n layer merges these into `data` for message templating.
   * Non-primitive issue fields (RegExp `pattern`, functions) are dropped.
   */
  params?: Record<string, unknown>;
}

/** Pull JSON-safe interpolation params off a Zod issue (everything but path/message/code). */
function extractParams(issue: Record<string, unknown>): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(issue)) {
    if (key === 'path' || key === 'message' || key === 'code') continue;
    const t = typeof value;
    if (value === null || t === 'string' || t === 'number' || t === 'boolean') {
      out[key] = value;
    } else if (Array.isArray(value) && value.every((v) => ['string', 'number', 'boolean'].includes(typeof v))) {
      out[key] = value;
    }
    // drop RegExp / objects / functions — not interpolation-safe
  }
  return Object.keys(out).length ? out : undefined;
}

const toIssues = (error: z.ZodError, source: string): ZodIssueDetail[] =>
  error.issues.map((issue) => ({
    path: issue.path.join('.') || source,
    message: issue.message,
    code: issue.code,
    params: extractParams(issue as unknown as Record<string, unknown>),
  }));

/**
 * Parse `payload` against `schema`. Returns the typed, coerced value on success.
 * On failure throws `BadRequestException` with body
 * `apiError('core.validation.failed', 'Validation failed', { issues })`.
 *
 * Schema authors should set each field's message to an i18n code (e.g.
 * `z.string({ message: 'core.validation.name.required' })`) — the consumer's i18n
 * layer maps `issues[].message` + `data` to a localized string.
 */
export function parseZod<T extends ZodTypeAny>(schema: T, payload: unknown, source: ZodSource = 'body'): z.infer<T> {
  const parsed = schema.safeParse(payload);
  if (parsed.success) return parsed.data;
  throw new BadRequestException(apiError('core.validation.failed', 'Validation failed', { issues: toIssues(parsed.error, source) }));
}

export { toIssues };
