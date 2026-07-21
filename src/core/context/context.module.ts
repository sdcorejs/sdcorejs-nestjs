import { type DynamicModule, type MiddlewareConsumer, Module, type NestModule, type Provider } from '@nestjs/common';
import { ContextMiddleware } from './context.middleware';
import { ContextService } from './context.service';
import { defaultVerifiedPrincipalResolver } from './identity.resolver';
import { DEFAULT_HEADERS_CONFIG, type ContextIdentityOptions, type HeadersConfig, type ResolvedContextIdentityOptions } from './types';
import { CONTEXT_HEADERS_CONFIG, CONTEXT_IDENTITY_CONFIG } from './tokens';

export interface ContextModuleOptions {
  headers?: Partial<HeadersConfig>;
  /** Configure verified-principal mapping and optional, explicitly verified trusted-header mode. */
  identity?: ContextIdentityOptions;
}

@Module({})
export class ContextModule implements NestModule {
  static forRoot(options: ContextModuleOptions = {}): DynamicModule {
    const headersProvider: Provider = {
      provide: CONTEXT_HEADERS_CONFIG,
      useValue: { ...DEFAULT_HEADERS_CONFIG, ...options.headers } satisfies HeadersConfig,
    };
    if (options.identity?.trustedHeaders && typeof options.identity.trustedHeaders.isTrustedRequest !== 'function') {
      throw new Error('context.identity.trustedHeaders.isTrustedRequest must be a verification function');
    }
    const identityProvider: Provider = {
      provide: CONTEXT_IDENTITY_CONFIG,
      useValue: {
        principalResolver: options.identity?.principalResolver ?? defaultVerifiedPrincipalResolver,
        trustedHeaders: options.identity?.trustedHeaders,
      } satisfies ResolvedContextIdentityOptions,
    };
    return {
      module: ContextModule,
      global: true,
      providers: [ContextService, ContextMiddleware, headersProvider, identityProvider],
      exports: [ContextService, ContextMiddleware, CONTEXT_HEADERS_CONFIG, CONTEXT_IDENTITY_CONFIG],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(ContextMiddleware).forRoutes('*');
  }
}
