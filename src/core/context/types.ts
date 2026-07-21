import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Per-request context populated by `ContextMiddleware` and read by `ContextService`.
 *
 * Lib keeps only framework-generic fields. Domain values (departmentCode, project,
 * username, fullName, internal-secret, …) belong to the consumer — extend via
 * `custom` bag or TypeScript declaration merging.
 *
 * @example consumer-side declaration merging:
 *   declare module '@sdcorejs/nestjs/core' {
 *     interface RequestContext { departmentCode?: string; }
 *   }
 */
export interface RequestContext {
  userId?: string;
  /** Framework-level tenant identifier value (NOT the column name). */
  tenant?: string;
  /** Roles derived from an authenticated principal or a verified trusted gateway. */
  roles?: string[];
  lang?: string;
  token?: string;
  /** Filled by `AuthGuard` after JWT validation. Shape is consumer-defined. */
  user?: unknown;
  permissions?: string[];
  /** Consumer-defined version/fingerprint for permission-sensitive cache variation. */
  permissionVersion?: string;
  /** Trust path that last established the security-sensitive identity fields. */
  identitySource?: IdentityContextSource;
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

/** Source that established the security-sensitive fields in {@link RequestContext}. */
export type IdentityContextSource = 'trusted-headers' | 'verified-principal';

/**
 * Security-sensitive identity values accepted by the request context.
 *
 * A verified-principal resolver must return `userId`; trusted gateway resolvers may return a
 * partial value because some gateways establish only a tenant boundary.
 */
export interface ResolvedContextIdentity {
  userId: string;
  tenant?: string;
  roles?: string[];
  permissions?: string[];
  permissionVersion?: string;
  custom?: Record<string, unknown>;
}

/** Maps a Passport-verified `req.user` object to the library's canonical request identity. */
export type VerifiedPrincipalResolver = (
  principal: unknown,
  request?: IncomingMessage,
) => ResolvedContextIdentity | Promise<ResolvedContextIdentity>;

/**
 * Explicit trusted-header mode. Both the request trust verifier and the identity resolver execute
 * before header-derived identity is admitted to the context. The verifier should validate a real
 * gateway boundary such as an allowlisted proxy address, mTLS peer, or signed headers.
 */
export interface TrustedHeaderIdentityOptions {
  /** Return `true` only when this request came through the configured trusted gateway boundary. */
  isTrustedRequest: (request: IncomingMessage) => boolean;
  /**
   * Optional custom header-to-identity mapping. When omitted, `HeadersConfig.tenant`, `userId`, and
   * `customHeaders` are read after trust verification.
   */
  resolve?: (request: IncomingMessage) => Partial<ResolvedContextIdentity>;
}

/** Identity establishment options used by `ContextMiddleware` and `AuthGuard`. */
export interface ContextIdentityOptions {
  /** Maps the verified Passport principal. Defaults to `defaultVerifiedPrincipalResolver`. */
  principalResolver?: VerifiedPrincipalResolver;
  /** Header identity is disabled unless this explicit, verifiable mode is configured. */
  trustedHeaders?: TrustedHeaderIdentityOptions;
}

/**
 * Fully resolved identity configuration registered through `CONTEXT_IDENTITY_CONFIG`.
 * This public contract is useful for custom providers and guard-level integration tests;
 * ordinary applications should configure the narrower {@link ContextIdentityOptions} instead.
 */
export interface ResolvedContextIdentityOptions {
  principalResolver: VerifiedPrincipalResolver;
  trustedHeaders?: TrustedHeaderIdentityOptions;
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
