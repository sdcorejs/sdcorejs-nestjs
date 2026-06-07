import { Inject, Injectable, Optional } from '@nestjs/common';
import axios, { type AxiosInstance, type AxiosRequestConfig } from 'axios';
import { ContextService } from '../context/context.service';
import { DEFAULT_HEADERS_CONFIG, type HeadersConfig } from '../context/types';
import { CONTEXT_HEADERS_CONFIG } from '../context/tokens';
import { HTTP_CLIENT_CONFIG, type HttpClientConfig } from './types';

/**
 * Axios-based HTTP client. Auto-propagates canonical context headers (`tenant`, `userId`)
 * + any consumer-declared `customHeaders` to outbound requests when `ContextService` is
 * registered.
 */
@Injectable()
export class HttpService {
  private readonly client: AxiosInstance;
  private readonly propagate: string[];

  constructor(
    @Optional() @Inject(HTTP_CLIENT_CONFIG) cfg: HttpClientConfig = {},
    @Optional() @Inject(ContextService) private readonly context?: ContextService,
    @Optional() @Inject(CONTEXT_HEADERS_CONFIG) private readonly headers?: HeadersConfig,
  ) {
    this.client = axios.create({
      baseURL: cfg.baseURL,
      timeout: cfg.timeout ?? 30_000,
    });
    const map = headers ?? DEFAULT_HEADERS_CONFIG;
    this.propagate =
      cfg.propagateHeaders ??
      [map.tenant ?? 'x-tenant', map.userId ?? 'x-user-id', ...Object.values(map.customHeaders ?? {})].filter((h): h is string => !!h);

    this.client.interceptors.request.use((config) => {
      const ctx = this.context?.store;
      if (!ctx) return config;
      config.headers = config.headers ?? {};
      const ctxMap = this.contextHeaderMap(ctx as unknown as Record<string, unknown>);
      for (const headerName of this.propagate) {
        const value = ctxMap[headerName];
        if (value !== undefined) config.headers[headerName] = value;
      }
      return config;
    });
  }

  async get<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    return (await this.client.get<T>(url, config)).data;
  }
  async post<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    return (await this.client.post<T>(url, data, config)).data;
  }
  async put<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    return (await this.client.put<T>(url, data, config)).data;
  }
  async patch<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    return (await this.client.patch<T>(url, data, config)).data;
  }
  async delete<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    return (await this.client.delete<T>(url, config)).data;
  }

  private contextHeaderMap(ctx: Record<string, unknown>): Record<string, string> {
    const map = this.headers ?? DEFAULT_HEADERS_CONFIG;
    const out: Record<string, string> = {};
    if (map.tenant && ctx.tenant != null) out[map.tenant] = String(ctx.tenant);
    if (map.userId && ctx.userId != null) out[map.userId] = String(ctx.userId);
    const custom = ctx.custom as Record<string, unknown> | undefined;
    if (custom) {
      for (const [ctxKey, headerName] of Object.entries(map.customHeaders ?? {})) {
        const value = custom[ctxKey];
        if (value != null) out[headerName] = String(value);
      }
    }
    return out;
  }
}
