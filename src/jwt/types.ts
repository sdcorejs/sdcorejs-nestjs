export interface JwtConfig {
  secret: string;
  expiresIn?: string | number;
  issuer?: string;
  audience?: string;
  /** Cookie name to extract JWT from (fallback when `Authorization` header missing). */
  cookieName?: string;
}

/** DI token for the registered `JwtConfig`. */
export const JWT_CONFIG = Symbol('JWT_CONFIG');
