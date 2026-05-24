import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Per-request context populated by `ContextMiddleware` and read by `ContextService`.
 *
 * Lib keeps only framework-generic fields. Domain values (departmentCode, project,
 * username, fullName, internal-secret, …) belong to the consumer — extend via
 * `custom` bag or TypeScript declaration merging.
 *
 * @example consumer-side declaration merging:
 *   declare module '@sdcorejs/nestjs/context' {
 *     interface RequestContext { departmentCode?: string; }
 *   }
 */
export interface RequestContext {
  userId?: string;
  /** Framework-level tenant identifier value (NOT the column name). */
  tenant?: string;
  lang?: string;
  token?: string;
  /** Filled by `AuthGuard` after JWT validation. Shape is consumer-defined. */
  user?: unknown;
  permissions?: string[];
  request?: IncomingMessage;
  response?: ServerResponse;
  /** Free-form bag for consumer-specific values. */
  custom?: Record<string, unknown>;
}

/**
 * Maps a `RequestContext` key to the inbound HTTP header name that supplies its value.
 * Only framework-generic keys map by default. Consumer adds more via `customHeaders` to
 * populate `custom.<key>` from a header without redeclaring `RequestContext`.
 */
export interface HeadersConfig {
  tenant?: string;
  userId?: string;
  lang?: string[];
  /** Extra `{ contextCustomKey: headerName }` pairs; values land in `ctx.custom`. */
  customHeaders?: Record<string, string>;
}

/**
 * Default header names. `lang` not resolved here — `ContextMiddleware.detectLang` reads
 * raw values and consumer's resolver decides the parsed code.
 */
export const DEFAULT_HEADERS_CONFIG: Required<Omit<HeadersConfig, 'customHeaders'>> & Pick<HeadersConfig, 'customHeaders'> = {
  tenant: 'x-tenant',
  userId: 'x-user-id',
  lang: ['accept-language', 'x-language'],
  customHeaders: {},
};
