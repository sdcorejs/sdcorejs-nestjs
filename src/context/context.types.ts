import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Per-request context populated by `ContextMiddleware` and read by `ContextService`.
 *
 * Lib keeps only the framework-generic fields. Domain-specific values (departmentCode,
 * project, username, fullName, internal-secret flags, …) belong to the consumer — extend
 * via `custom` bag or TypeScript declaration merging on this interface.
 *
 * @example consumer-side declaration merging:
 *   declare module '@sdcorejs/nestjs/context' {
 *     interface RequestContext { departmentCode?: string; }
 *   }
 */
export interface RequestContext {
  userId?: string;
  tenantCode?: string;
  lang?: 'vi' | 'en';
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
  tenantCode?: string;
  userId?: string;
  lang?: string[];
  /** Extra `{ contextCustomKey: headerName }` pairs; values land in `ctx.custom`. */
  customHeaders?: Record<string, string>;
}

/**
 * Default header names. Only the multi-tenancy + user identity + language headers are
 * canonical here; everything else is a consumer concern.
 */
export const DEFAULT_HEADERS_CONFIG: Required<Omit<HeadersConfig, 'customHeaders'>> & Pick<HeadersConfig, 'customHeaders'> = {
  tenantCode: 'x-tenant-code',
  userId: 'x-user-id',
  lang: ['accept-language', 'x-language'],
  customHeaders: {},
};
