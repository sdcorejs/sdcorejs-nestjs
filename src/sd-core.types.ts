import type { Provider } from '@nestjs/common';
import type { ContextModuleOptions } from './core/context/context.module';
import type { TenancyModuleOptions } from './core/tenancy/tenancy.module';
import type { AuditModuleOptions } from './core/audit/audit.module';
import type { PermissionModuleOptions } from './auth/permission/permission.module';
import type { CacheConfig } from './services/cache/types';
import type { HttpClientConfig } from './services/http/types';
import type { JwtConfig } from './auth/jwt/types';
import type { I18nModuleOptions } from './i18n/i18n.module';

export interface SdCoreModuleOptions {
  context?: ContextModuleOptions;
  tenancy?: TenancyModuleOptions;
  audit?: AuditModuleOptions;
  permission?: PermissionModuleOptions;
  cache?: CacheConfig;
  http?: HttpClientConfig;
  /** JWT is opt-in — omit to skip wiring passport-jwt. */
  jwt?: JwtConfig;
  /**
   * i18n is opt-in — omit to leave error envelopes untranslated (raw `code` + default `message`).
   * When set, wires `SdI18nExceptionFilter` globally and a catalog-backed resolver (built-in en/vi
   * `core.*` messages merged with your `catalogs`).
   */
  i18n?: I18nModuleOptions;
  /**
   * Extension providers registered globally. Use to wire DI hooks lib exposes (e.g.
   * `INTERNAL_SECRET_PROVIDER`) without nesting another module.
   *
   * @example
   * providers: [
   *   { provide: INTERNAL_SECRET_PROVIDER, useClass: MyInternalSecretProvider },
   * ]
   */
  providers?: Provider[];
}
