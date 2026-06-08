import { type DynamicModule, Module, type Provider } from '@nestjs/common';
import { ContextModule } from './core/context/context.module';
import { TenancyModule } from './core/tenancy/tenancy.module';
import { AuditModule } from './core/audit/audit.module';
import { PermissionModule } from './auth/permission/permission.module';
import { CacheModule } from './services/cache/cache.module';
import { HttpClientModule } from './services/http/http.module';
import { JwtModule } from './auth/jwt/jwt.module';
import { I18nModule } from './i18n/i18n.module';
import type { SdCoreModuleOptions } from './sd-core.types';

/**
 * Top-level module composing every sub-module's `forRoot`. Pass per-sub-module overrides;
 * omitted keys use the no-op / default strategy. The optional `providers` array is a
 * passthrough for consumer-side DI tokens (e.g. `INTERNAL_SECRET_PROVIDER`).
 *
 * @example
 * SdCoreModule.forRoot({
 *   context: { headers: { tenant: 'X-Org-Id' } },
 *   tenancy: { strategy: MyTenancyStrategy },
 *   audit:   { strategy: MyAuditStrategy },
 *   permission: { strategy: MyPermissionStrategy },
 *   cache:   { ttl: 120 },
 *   http:    { baseURL: 'http://api.internal' },
 *   jwt:     { secret: process.env.JWT_SECRET! },
 *   providers: [
 *     { provide: INTERNAL_SECRET_PROVIDER, useClass: MyInternalSecretProvider },
 *   ],
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
    if (options.i18n) imports.push(I18nModule.forRoot(options.i18n));
    const providers: Provider[] = options.providers ?? [];
    return {
      module: SdCoreModule,
      global: true,
      imports,
      providers,
      exports: [...imports, ...providers.map((p) => ('provide' in p ? p.provide : p))],
    };
  }
}
