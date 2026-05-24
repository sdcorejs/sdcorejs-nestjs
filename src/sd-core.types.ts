import type { ContextModuleOptions } from './context/context.module';
import type { TenancyModuleOptions } from './tenancy/tenancy.module';
import type { AuditModuleOptions } from './audit/audit.module';
import type { PermissionModuleOptions } from './permission/permission.module';
import type { CacheConfig } from './cache/types';
import type { HttpClientConfig } from './http/types';
import type { JwtConfig } from './jwt/types';

export interface SdCoreModuleOptions {
  context?: ContextModuleOptions;
  tenancy?: TenancyModuleOptions;
  audit?: AuditModuleOptions;
  permission?: PermissionModuleOptions;
  cache?: CacheConfig;
  http?: HttpClientConfig;
  /** JWT is opt-in — omit to skip wiring passport-jwt. */
  jwt?: JwtConfig;
}
