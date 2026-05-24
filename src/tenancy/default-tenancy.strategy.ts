import { Injectable } from '@nestjs/common';
import type { ITenancyStrategy } from './strategy.interface';

/**
 * No-op default — tenancy effectively disabled. Repositories see empty scope and always bypass.
 * Replace via `TenancyModule.forRoot({ strategy: MyTenancyStrategy })` to activate.
 */
@Injectable()
export class DefaultTenancyStrategy implements ITenancyStrategy {
  getCurrentScope(): Record<string, unknown> {
    return {};
  }
  shouldBypass(): boolean {
    return true;
  }
}
