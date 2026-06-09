import { type DynamicModule, Module, type Provider, type Type } from '@nestjs/common';
import { AuthGuard } from './auth.guard';
import { DefaultPermissionStrategy } from './default-permission.strategy';
import { InternalGuard } from './internal.guard';
import type { IPermissionStrategy } from './strategy.interface';
import { PERMISSION_STRATEGY } from './tokens';

export interface PermissionModuleOptions {
  strategy?: Type<IPermissionStrategy>;
}

@Module({})
export class PermissionModule {
  static forRoot(options: PermissionModuleOptions = {}): DynamicModule {
    const provider: Provider = {
      provide: PERMISSION_STRATEGY,
      useClass: options.strategy ?? DefaultPermissionStrategy,
    };
    return {
      module: PermissionModule,
      global: true,
      providers: [provider, AuthGuard, InternalGuard],
      exports: [PERMISSION_STRATEGY, AuthGuard, InternalGuard],
    };
  }
}
