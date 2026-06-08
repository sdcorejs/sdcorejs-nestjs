import { type DynamicModule, Module, type Provider, type Type } from '@nestjs/common';
import { ContextService } from '../context/context.service';
import { DefaultTenancyStrategy } from './default-tenancy.strategy';
import type { ITenancyStrategy } from './strategy.interface';
import { registerTenancy } from './tenancy.registry';
import { TENANCY_STRATEGY } from './tokens';

export interface TenancyModuleOptions {
  /** Class providing `ITenancyStrategy`. Defaults to `DefaultTenancyStrategy` (no-op). */
  strategy?: Type<ITenancyStrategy>;
  /** Register the module globally. Default `true`. */
  global?: boolean;
  /** Bind the strategy into the process-wide tenancy registry so every `BaseRepository` uses it. Default `true`. */
  registerGlobally?: boolean;
}

@Module({})
export class TenancyModule {
  static forRoot(options: TenancyModuleOptions = {}): DynamicModule {
    const providers: Provider[] = [{ provide: TENANCY_STRATEGY, useClass: options.strategy ?? DefaultTenancyStrategy }];
    if (options.registerGlobally !== false) {
      providers.push({
        provide: 'TENANCY_REGISTRY_BINDING',
        useFactory: (strategy: ITenancyStrategy, contextService?: ContextService) => {
          registerTenancy({ strategy, contextService });
          return true;
        },
        inject: [TENANCY_STRATEGY, { token: ContextService, optional: true }],
      });
    }
    return {
      module: TenancyModule,
      global: options.global !== false,
      providers,
      exports: [TENANCY_STRATEGY],
    };
  }
}
