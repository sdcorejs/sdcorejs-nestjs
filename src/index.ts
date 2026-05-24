export * from './sd-core.module';
export * from './sd-core.types';

// Re-export commonly-needed pieces for ergonomic root import. Sub-paths remain the canonical
// import points for the full surface area of each module.
export { ContextService } from './context/context.service';
export { CONTEXT_HEADERS_CONFIG } from './context/tokens';
export { TENANCY_STRATEGY } from './tenancy/tokens';
export { AUDIT_STRATEGY } from './audit/tokens';
export { PERMISSION_STRATEGY, PERMISSION_METADATA_KEY } from './permission/tokens';
export { HasPermission, HasAnyPermission } from './permission/decorators';
export type { ITenancyStrategy } from './tenancy/strategy.interface';
export type { IAuditStrategy } from './audit/strategy.interface';
export type { IPermissionStrategy } from './permission/strategy.interface';
export type { RequestContext, HeadersConfig } from './context/context.types';
