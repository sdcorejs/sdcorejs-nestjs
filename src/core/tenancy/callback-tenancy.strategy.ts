import type { RequestContext } from '../context/types';
import type { ITenancyStrategy, TenancyBypassGrant } from './strategy.interface';

export interface TenancyCallbacks {
  resolve?: (rc: RequestContext) => Record<string, unknown>;
  /** @deprecated Boolean `true` is rejected. Use `bypassGrant` with verified identity and audit. */
  bypass?: (rc: RequestContext) => boolean;
  /** Resolve an explicit authorized and auditable privileged-access grant. */
  bypassGrant?: (rc: RequestContext) => TenancyBypassGrant | undefined;
}

/** Wraps inline resolve/bypass callbacks into an ITenancyStrategy — lets consumers express tenancy
 *  policy as SdCoreModule config instead of a dedicated strategy class. */
export class CallbackTenancyStrategy implements ITenancyStrategy {
  constructor(private readonly cb: TenancyCallbacks) {}
  getCurrentScope(ctx: RequestContext): Record<string, unknown> {
    return this.cb.resolve?.(ctx) ?? {};
  }
  shouldBypass(ctx: RequestContext): boolean {
    return this.cb.bypass?.(ctx) ?? false;
  }
  getBypassGrant(ctx: RequestContext): TenancyBypassGrant | undefined {
    return this.cb.bypassGrant?.(ctx);
  }
}
