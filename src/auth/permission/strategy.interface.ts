import type { RequestContext } from '../../core/context/types';

/**
 * Contract for permission resolution. `AuthGuard` calls `load(ctx)` once per request and
 * caches the resulting code array on `request.permissions`. `check` decides whether a
 * required code is satisfied by the cached set — default is `Array.includes`.
 *
 * Override `check` to support wildcards (`product:*`), tenant scoping, hierarchical roles, etc.
 */
export interface IPermissionStrategy {
  load(ctx: RequestContext): Promise<string[]>;
  check?(codes: string[], required: string): boolean;
}
