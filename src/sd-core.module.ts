import { type DynamicModule, Module } from '@nestjs/common';
import { ContextModule } from './context/context.module';
import { TenancyModule } from './tenancy/tenancy.module';
import { AuditModule } from './audit/audit.module';
import { PermissionModule } from './permission/permission.module';
import { CacheModule } from './cache/cache.module';
import { HttpClientModule } from './http/http.module';
import { JwtModule } from './jwt/jwt.module';
import type { SdCoreModuleOptions } from './sd-core.types';

/**
 * Top-level module composing every sub-module's `forRoot`. Pass per-sub-module overrides;
 * omitted keys use the no-op / default strategy.
 *
 * @example
 * SdCoreModule.forRoot({
 *   context: { headers: { tenantCode: 'X-Org-Id' } },
 *   tenancy: { strategy: MyTenancyStrategy },
 *   audit:   { strategy: MyAuditStrategy },
 *   permission: { strategy: MyPermissionStrategy },
 *   cache:   { ttl: 120 },
 *   http:    { baseURL: 'http://api.internal' },
 *   jwt:     { secret: process.env.JWT_SECRET! },
 * })
 */
@Module({})
export class SdCoreModule {
  static forRoot(options: SdCoreModuleOptions = {}): DynamicModule {
    const imports: DynamicModule[] = [
      ContextModule.forRoot(options.context),
      TenancyModule.forRoot(options.tenancy),
      AuditModule.forRoot(options.audit),
      PermissionModule.forRoot(options.permission),
      CacheModule.forRoot(options.cache),
      HttpClientModule.forRoot(options.http),
    ];
    if (options.jwt) imports.push(JwtModule.forRoot(options.jwt));
    return {
      module: SdCoreModule,
      imports,
      exports: imports,
    };
  }
}
