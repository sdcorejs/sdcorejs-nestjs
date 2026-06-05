import type { ContextService } from '../context/context.service';
import type { ITenancyStrategy } from './strategy.interface';

/** Process-wide tenancy binding, mirroring the history-recorder pattern in `orm/history.ts`. */
export interface RegisteredTenancy {
  strategy: ITenancyStrategy;
  contextService?: ContextService;
}

let _tenancy: RegisteredTenancy | undefined;

/**
 * Register the process-wide tenancy strategy + context. Called once at bootstrap by
 * `TenancyModule.forRoot`. A `BaseRepository` with no explicit `tenancyStrategy` option uses this.
 */
export const registerTenancy = (tenancy: RegisteredTenancy): void => {
  _tenancy = tenancy;
};

/** The globally-registered tenancy binding, if any. */
export const getTenancy = (): RegisteredTenancy | undefined => _tenancy;
