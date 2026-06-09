import { type DynamicModule, Module, type Provider, type Type } from '@nestjs/common';
import { ContextService } from '../context/context.service';
import { DefaultTenancyStrategy } from './default-tenancy.strategy';
import { CallbackTenancyStrategy, type TenancyCallbacks } from './callback-tenancy.strategy';
import type { ITenancyStrategy } from './strategy.interface';
import { registerTenancy } from './tenancy.registry';
import { TENANCY_STRATEGY } from './tokens';

export interface TenancyModuleOptions {
  /** Class providing `ITenancyStrategy`. Defaults to `DefaultTenancyStrategy` (no-op). */
  strategy?: Type<ITenancyStrategy>;
  /** Inline resolve callback — shorthand for wrapping a `CallbackTenancyStrategy`. Ignored when `strategy` is set. */
  resolve?: TenancyCallbacks['resolve'];
  /** Inline bypass callback — shorthand for wrapping a `CallbackTenancyStrategy`. Ignored when `strategy` is set. */
  bypass?: TenancyCallbacks['bypass'];
  /** Register the module globally. Default `true`. */
  global?: boolean;
  /** Bind the strategy into the process-wide tenancy registry so every `BaseRepository` uses it. Default `true`. */
  registerGlobally?: boolean;
}

@Module({})
export class TenancyModule {
  static forRoot(options: TenancyModuleOptions = {}): DynamicModule {
    const strategyProvider: Provider = options.strategy
      ? { provide: TENANCY_STRATEGY, useClass: options.strategy }
      : (options.resolve ?? options.bypass)
        ? {
            provide: TENANCY_STRATEGY,
            useFactory: () => new CallbackTenancyStrategy({ resolve: options.resolve, bypass: options.bypass }),
          }
        : { provide: TENANCY_STRATEGY, useClass: DefaultTenancyStrategy };
    const providers: Provider[] = [strategyProvider];
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
