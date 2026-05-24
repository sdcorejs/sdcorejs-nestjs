import { type DynamicModule, Module, type Provider, type Type } from '@nestjs/common';
import { DefaultTenancyStrategy } from './default-tenancy.strategy';
import type { ITenancyStrategy } from './strategy.interface';
import { TENANCY_STRATEGY } from './tokens';

export interface TenancyModuleOptions {
  /** Class providing `ITenancyStrategy`. Defaults to `DefaultTenancyStrategy` (no-op). */
  strategy?: Type<ITenancyStrategy>;
}

@Module({})
export class TenancyModule {
  static forRoot(options: TenancyModuleOptions = {}): DynamicModule {
    const provider: Provider = {
      provide: TENANCY_STRATEGY,
      useClass: options.strategy ?? DefaultTenancyStrategy,
    };
    return {
      module: TenancyModule,
      global: true,
      providers: [provider],
      exports: [TENANCY_STRATEGY],
    };
  }
}
