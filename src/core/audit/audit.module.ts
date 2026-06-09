import { type DynamicModule, Module, type Provider, type Type } from '@nestjs/common';
import { AuditSubscriber } from './audit.subscriber';
import { DefaultAuditStrategy } from './default-audit.strategy';
import type { IAuditStrategy } from './strategy.interface';
import { AUDIT_STRATEGY } from './tokens';

export interface AuditModuleOptions {
  /** Provider class for `IAuditStrategy`. Defaults to `DefaultAuditStrategy`. */
  strategy?: Type<IAuditStrategy>;
}

@Module({})
export class AuditModule {
  static forRoot(options: AuditModuleOptions = {}): DynamicModule {
    const provider: Provider = {
      provide: AUDIT_STRATEGY,
      useClass: options.strategy ?? DefaultAuditStrategy,
    };
    return {
      module: AuditModule,
      global: true,
      providers: [provider, AuditSubscriber],
      exports: [AUDIT_STRATEGY, AuditSubscriber],
    };
  }
}
