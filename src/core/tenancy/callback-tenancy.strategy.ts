import type { RequestContext } from '../context/types';
import type { ITenancyStrategy } from './strategy.interface';

export interface TenancyCallbacks {
  resolve?: (rc: RequestContext) => Record<string, unknown>;
  bypass?: (rc: RequestContext) => boolean;
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
}
