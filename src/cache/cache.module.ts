import { type DynamicModule, Module } from '@nestjs/common';
import { CacheInterceptor } from './cache.interceptor';
import { CacheService } from './cache.service';
import { RequestCacheMiddleware } from './request-cache.middleware';
import { CACHE_CONFIG, type CacheConfig } from './types';

@Module({})
export class CacheModule {
  static forRoot(config: CacheConfig = {}): DynamicModule {
    return {
      module: CacheModule,
      global: true,
      providers: [
        { provide: CACHE_CONFIG, useValue: config },
        CacheService,
        CacheInterceptor,
        RequestCacheMiddleware,
      ],
      exports: [CACHE_CONFIG, CacheService, CacheInterceptor, RequestCacheMiddleware],
    };
  }
}
