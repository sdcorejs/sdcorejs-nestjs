import { Injectable } from '@nestjs/common';
import type { ITenancyStrategy } from './strategy.interface';

/**
 * Fail-closed default. It leaves unscoped entities unchanged, while a `@Scoped()` entity rejects
 * access until the consumer configures a strategy that supplies every required scope value.
 */
@Injectable()
export class DefaultTenancyStrategy implements ITenancyStrategy {
  getCurrentScope(): Record<string, unknown> {
    return {};
  }
  shouldBypass(): boolean {
    return false;
  }
}
