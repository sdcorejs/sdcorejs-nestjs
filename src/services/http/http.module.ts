import { type DynamicModule, Module } from '@nestjs/common';
import { HttpService } from './http.service';
import { HTTP_CLIENT_CONFIG, type HttpClientConfig } from './types';

@Module({})
export class HttpClientModule {
  static forRoot(config: HttpClientConfig = {}): DynamicModule {
    return {
      module: HttpClientModule,
      global: true,
      providers: [{ provide: HTTP_CLIENT_CONFIG, useValue: config }, HttpService],
      exports: [HTTP_CLIENT_CONFIG, HttpService],
    };
  }
}
