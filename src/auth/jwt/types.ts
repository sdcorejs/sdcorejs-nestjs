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
   * Exact-match issuer allowlist. A token whose `iss` is one of these is accepted; the JWKS is
   * fetched only from that exact issuer. Use when the set of realms is known and static.
   */
  allowedIssuers?: string[];
  /**
   * Origin allowlist for **dynamic** multi-realm setups (the recommended approach when realms are
   * created at runtime). A token is accepted when `new URL(iss).origin` matches one of these, so any
   * realm under a trusted Keycloak host is allowed (e.g. `['https://kc.example.com']` accepts
   * `https://kc.example.com/realms/<any-tenant>`). Because the JWKS is fetched from that same origin,
   * this also closes the SSRF surface — the server never calls an attacker-controlled host.
   */
  allowedIssuerHosts?: string[];
  /**
   * Full-control predicate escape hatch — return `true` to accept the `iss`. Runs in addition to
   * `allowedIssuers` / `allowedIssuerHosts`. Use for custom rules (regex, DB lookup of provisioned
   * realms, etc.).
   */
  issuerValidator?: (iss: string) => boolean;
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
