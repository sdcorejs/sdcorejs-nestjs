import {
  type DynamicModule,
  type MiddlewareConsumer,
  Module,
  type NestModule,
  type Provider,
} from '@nestjs/common';
import { ContextMiddleware } from './context.middleware';
import { ContextService } from './context.service';
import { DEFAULT_HEADERS_CONFIG, type HeadersConfig } from './types';
import { CONTEXT_HEADERS_CONFIG } from './tokens';

export interface ContextModuleOptions {
  headers?: Partial<HeadersConfig>;
}

@Module({})
export class ContextModule implements NestModule {
  static forRoot(options: ContextModuleOptions = {}): DynamicModule {
    const headersProvider: Provider = {
      provide: CONTEXT_HEADERS_CONFIG,
      useValue: { ...DEFAULT_HEADERS_CONFIG, ...options.headers } satisfies HeadersConfig,
    };
    return {
      module: ContextModule,
      global: true,
      providers: [ContextService, ContextMiddleware, headersProvider],
      exports: [ContextService, ContextMiddleware, CONTEXT_HEADERS_CONFIG],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(ContextMiddleware).forRoutes('*');
  }
}
