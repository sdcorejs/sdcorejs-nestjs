/**
 * DI hook for internal-call auth. Backend implements + registers via
 * `SdCoreModule.forRoot({ providers: [{ provide: INTERNAL_SECRET_PROVIDER, useClass: ... }] })`.
 *
 * `InternalGuard` calls `getKey()` per request and compares with constant-time semantics
 * against the inbound `X-Internal-Secret` header (header name overridable).
 */
export interface IInternalSecretProvider {
  /** Return the secret expected for current internal calls (env var, secrets manager, …). */
  getKey(): string | Promise<string>;
}

export const INTERNAL_SECRET_PROVIDER = Symbol('INTERNAL_SECRET_PROVIDER');
