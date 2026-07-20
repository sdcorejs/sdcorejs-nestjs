import type { ContextService } from '../context/context.service';
import type { ITenancyStrategy } from './strategy.interface';

/** Process-wide tenancy binding, mirroring the history-recorder pattern in `orm/history.ts`. */
export interface RegisteredTenancy {
  strategy: ITenancyStrategy;
  contextService?: ContextService;
}

/**
 * Held on `globalThis` under a global symbol — NOT a module-level `let` — because consumers can load
 * the package through different public subpaths or physical dependency copies. A module-level
 * singleton could then be duplicated: `TenancyModule` would register into one graph while
 * `BaseRepository` read another, and tenancy would silently never activate. A `globalThis` slot
 * keyed by `Symbol.for` is shared across every package graph in the process.
 */
const SLOT = Symbol.for('@sdcorejs/nestjs:tenancy-registry');
interface Holder {
  current?: RegisteredTenancy;
}
const holder: Holder = ((globalThis as Record<symbol, unknown>)[SLOT] as Holder) ?? {};
(globalThis as Record<symbol, unknown>)[SLOT] = holder;

/**
 * Register the process-wide tenancy strategy + context. Called once at bootstrap by
 * `TenancyModule.forRoot`. A `BaseRepository` with no explicit `tenancyStrategy` option uses this.
 */
export const registerTenancy = (tenancy: RegisteredTenancy): void => {
  holder.current = tenancy;
};

/** The globally-registered tenancy binding, if any. */
export const getTenancy = (): RegisteredTenancy | undefined => holder.current;
