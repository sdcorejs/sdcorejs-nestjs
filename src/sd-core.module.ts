import { type DynamicModule, Module, type Provider } from '@nestjs/common';
import { ContextModule } from './core/context/context.module';
import { TenancyModule } from './core/tenancy/tenancy.module';
import { AuditModule } from './core/audit/audit.module';
import { PermissionModule } from './auth/permission/permission.module';
import { CacheModule } from './services/cache/cache.module';
import { HttpClientModule } from './services/http/http.module';
import { JwtModule } from './auth/jwt/jwt.module';
import { I18nModule } from './i18n/i18n.module';
import { INTERNAL_SECRET_PROVIDER, EnvInternalSecretProvider } from './auth/permission';
import { UploadedFileModule } from './features/uploaded-file/uploaded-file.module';
import { ActionHistoryModule } from './features/action-history/action-history.module';
import { JobSchedulerModule } from './features/job-scheduler/job-scheduler.module';
import { QueueModule } from './queue/queue.module';
import type { SdCoreModuleOptions } from './sd-core.types';

/**
 * Top-level module composing the always-on context/tenancy/audit/permission/cache/HTTP modules and
 * explicitly configured feature modules. Security-sensitive features remain disabled or fail
 * closed when their required strategy/context is absent. The optional `providers` array passes
 * consumer DI hooks such as `INTERNAL_SECRET_PROVIDER` through the global module.
 *
 * @example
 * SdCoreModule.forRoot({
 *   context: {
 *     identity: {
 *       principalResolver: (principal: unknown) => {
 *         const claims = AppClaimsSchema.parse(principal); // application-owned strict validator
 *         return { userId: claims.sub, tenant: claims.tenant };
 *       },
 *     },
 *   },
 *   tenancy: { strategy: MyTenancyStrategy },
 *   audit:   { strategy: MyAuditStrategy },
 *   permission: { strategy: MyPermissionStrategy },
 *   cache:   { backend: 'memory', ttl: 120 },
 *   http:    { baseURL: 'https://api.internal', trustedOrigins: ['https://api.internal'] },
 *   jwt:     { jwks: { allowedIssuers: [process.env.OIDC_ISSUER!] } },
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
    if (options.uploadedFile) imports.push(UploadedFileModule.forRoot(options.uploadedFile));
    if (options.actionHistory) imports.push(ActionHistoryModule.forRoot(options.actionHistory));
    if (options.jobScheduler) imports.push(JobSchedulerModule.forRoot(options.jobScheduler));
    if (options.queue) imports.push(QueueModule.forRoot(options.queue));
    const extraProviders: Provider[] = options.providers ?? [];
    const isCfg = options.internalSecret;
    const internalSecretProvider: Provider | null = isCfg
      ? 'key' in isCfg
        ? { provide: INTERNAL_SECRET_PROVIDER, useValue: { getKey: () => isCfg.key, getKeys: () => [isCfg.key] } }
        : { provide: INTERNAL_SECRET_PROVIDER, useFactory: () => new EnvInternalSecretProvider(isCfg.envVar) }
      : null;
    const providers: Provider[] = internalSecretProvider ? [internalSecretProvider, ...extraProviders] : extraProviders;
    return {
      module: SdCoreModule,
      global: true,
      imports,
      providers,
      exports: [...imports, ...providers.map((p) => ('provide' in p ? p.provide : p))],
    };
  }
}
