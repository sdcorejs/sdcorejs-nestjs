import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Per-request context populated by `ContextMiddleware` and read by `ContextService`.
 * Consumer apps may extend this via module augmentation (declaration merging on `custom`).
 */
export interface RequestContext {
  userId?: string;
  username?: string;
  fullName?: string;
  tenantCode?: string;
  departmentCode?: string;
  project?: string;
  lang?: 'vi' | 'en';
  token?: string;
  internalSecret?: string;
  /** Filled by `AuthGuard` after JWT validation. Shape is consumer-defined. */
  user?: unknown;
  isSystemAdmin?: boolean;
  isTenantAdmin?: boolean;
  permissions?: string[];
  request?: IncomingMessage;
  response?: ServerResponse;
  /** Free-form bag for consumer-specific values. */
  custom?: Record<string, unknown>;
}

/**
 * Maps a `RequestContext` key to the inbound HTTP header name that supplies its value.
 * Header names are case-insensitive — values are matched lower-cased against `req.headers`.
 * `lang` is an array (priority list); first matching header wins.
 */
export interface HeadersConfig {
  tenantCode?: string;
  departmentCode?: string;
  project?: string;
  internalSecret?: string;
  userId?: string;
  username?: string;
  fullName?: string;
  lang?: string[];
}

/**
 * Default header names from `be-masterdata/core-be`. Override individual keys via
 * `SdCoreModule.forRoot({ context: { headers: { ... } } })`.
 */
export const DEFAULT_HEADERS_CONFIG: Required<HeadersConfig> = {
  tenantCode: 'x-tenant-code',
  departmentCode: 'x-department-code',
  project: 'x-project',
  internalSecret: 'x-internal-secret',
  userId: 'x-user-id',
  username: 'x-username',
  fullName: 'x-full-name',
  lang: ['accept-language', 'x-language'],
};
