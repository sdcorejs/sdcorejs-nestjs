import { Injectable } from '@nestjs/common';

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
  /**
   * Optional. Return every currently-valid secret to support zero-downtime rotation: emit both
   * the outgoing and incoming key during the transition window. When present, `InternalGuard`
   * accepts a constant-time match against ANY returned key and ignores `getKey()`.
   */
  getKeys?(): string[] | Promise<string[]>;
}

export const INTERNAL_SECRET_PROVIDER = Symbol('INTERNAL_SECRET_PROVIDER');

/**
 * Default {@link IInternalSecretProvider}: returns `process.env[envVar]` (default `INTERNAL_SECRET_KEY`),
 * or `''` when unset — `''` never matches a present header, so internal routes stay closed until configured.
 */
@Injectable()
export class EnvInternalSecretProvider implements IInternalSecretProvider {
  constructor(private readonly envVar: string = 'INTERNAL_SECRET_KEY') {}
  getKey(): string {
    return process.env[this.envVar] ?? '';
  }
  getKeys(): string[] {
    const k = this.getKey();
    return k ? [k] : [];
  }
}
