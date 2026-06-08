/**
 * JWKS / OIDC verification options (asymmetric, e.g. Keycloak). When `JwtConfig.jwks` is set,
 * `JwtModule.forRoot` wires `KeycloakJwtStrategy`: the signing key is fetched from the issuer's
 * JWKS endpoint per token, so multiple realms / tenants (different `iss`) are supported with no
 * shared secret.
 */
export interface JwksConfig {
  /**
   * Build the JWKS endpoint URL from the token's `iss` claim.
   * Default (Keycloak): `${iss}/protocol/openid-connect/certs`.
   */
  jwksUriFromIssuer?: (iss: string) => string;
  /**
   * Optional issuer allowlist. When set, a token whose `iss` is not listed is rejected before any
   * network call. Default: allow any issuer (multi-tenant).
   */
  allowedIssuers?: string[];
  /** Accepted signing algorithms. Default: `['RS256']`. */
  algorithms?: string[];
  /** Cache signing keys (jwks-rsa `cache`). Default: `true`. */
  cache?: boolean;
  /** Rate-limit JWKS fetches (jwks-rsa `rateLimit`). Default: `true`. */
  rateLimit?: boolean;
}

export interface JwtConfig {
  /** Symmetric secret (HS*). Required for the default `JwtStrategy`; omit when using `jwks`. */
  secret?: string;
  /** Enable asymmetric JWKS/OIDC verification (Keycloak). Mutually exclusive with `secret`. */
  jwks?: JwksConfig;
  expiresIn?: string | number;
  issuer?: string;
  audience?: string;
  /** Cookie name to extract JWT from (fallback when `Authorization` header missing). */
  cookieName?: string;
}

/** DI token for the registered `JwtConfig`. */
export const JWT_CONFIG = Symbol('JWT_CONFIG');

/**
 * Minimal decoded-token shape passed to `validate()`. OIDC/Keycloak put the user id in `sub`.
 * Extend in your `validate` override as needed (realm roles, email, etc.).
 */
export interface JwtPayload {
  sub: string;
  iss?: string;
  [claim: string]: unknown;
}
