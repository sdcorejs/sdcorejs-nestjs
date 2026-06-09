export * from './sd-core.module';
export * from './sd-core.types';

// Re-export commonly-needed pieces for ergonomic root import. Sub-paths remain the canonical
// import points for the full surface area of each module.
export { ContextService } from './core/context/context.service';
export { CONTEXT_HEADERS_CONFIG } from './core/context/tokens';
export { TENANCY_STRATEGY } from './core/tenancy/tokens';
export { AUDIT_STRATEGY } from './core/audit/tokens';
export { PERMISSION_STRATEGY, PERMISSION_METADATA_KEY } from './auth/permission/tokens';
export { HasPermission, HasAnyPermission } from './auth/permission/decorators';
export { INTERNAL_SECRET_PROVIDER, type IInternalSecretProvider } from './auth/permission/internal-secret.provider';
export { INTERNAL_CONTEXT_ENRICHER, type IInternalContextEnricher } from './auth/permission/internal-context.enricher';
export { InternalGuard, INTERNAL_SECRET_HEADER } from './auth/permission/internal.guard';
export { apiError, ApiResponse, type ApiErrorBody, type ApiResponseEnvelope } from './core/orm/types/api-response.types';
export { ZodValidationGuard, parseZod, type ZodSource, type ZodIssueDetail, type ZodSchemaMap } from './validation';
export { I18N_RESOLVER, LANGUAGE_RESOLVER, type II18nResolver, type ILanguageResolver } from './i18n';
export type { ITenancyStrategy } from './core/tenancy/strategy.interface';
export type { IAuditStrategy } from './core/audit/strategy.interface';
export type { IPermissionStrategy } from './auth/permission/strategy.interface';
export type { RequestContext, HeadersConfig } from './core/context/types';
