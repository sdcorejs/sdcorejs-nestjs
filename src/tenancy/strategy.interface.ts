import type { RequestContext } from '../context/context.types';

/**
 * Contract for multi-tenancy enforcement. `BaseRepository` reads `@TenantScoped`-marked columns
 * on the entity and, when an `ITenancyStrategy` is registered, calls these methods to:
 * - Inject a filter `EQUAL` for every read (`paging/all/search/detail`)
 * - Auto-fill the same columns on `create/import` unless `shouldBypass(ctx)` returns `true`
 *
 * When NO strategy is registered, repository acts as if tenancy is disabled (zero overhead).
 */
export interface ITenancyStrategy {
  /** Returns scope values for the current request, keyed by entity column name. */
  getCurrentScope(ctx: RequestContext): Record<string, unknown>;
  /** When `true`, the repository skips filter injection AND auto-fill (admin / internal callers). */
  shouldBypass(ctx: RequestContext): boolean;
}
