import { Inject, Injectable, Optional } from '@nestjs/common';
import axios, { AxiosHeaders, type AxiosInstance, type AxiosRequestConfig } from 'axios';
import { INTERNAL_SECRET_HEADER } from '../../auth/permission/internal.guard';
import { ContextService } from '../../core/context/context.service';
import { DEFAULT_HEADERS_CONFIG, type HeadersConfig } from '../../core/context/types';
import { CONTEXT_HEADERS_CONFIG } from '../../core/context/tokens';
import { HTTP_CLIENT_CONFIG, type HttpClientConfig } from './types';

const AUTHORIZATION_HEADER = 'authorization';

/**
 * Axios-based HTTP client. Context identity headers are propagated only to exact origins declared
 * in `HttpClientConfig.trustedOrigins`; arbitrary absolute URLs and untrusted redirect targets have
 * those headers removed.
 */
@Injectable()
export class HttpService {
  private readonly client: AxiosInstance;
  private readonly propagate: string[];
  private readonly identityHeaderNames: Set<string>;
  private readonly trustedOrigins: Set<string>;

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
    const configuredIdentityHeaders = [
      map.tenant ?? 'x-tenant',
      map.userId ?? 'x-user-id',
      ...Object.values(map.customHeaders ?? {}),
    ].filter((header): header is string => !!header);
    this.propagate = (cfg.propagateHeaders ?? configuredIdentityHeaders).filter(
      (header) => ![AUTHORIZATION_HEADER, INTERNAL_SECRET_HEADER].includes(header.toLowerCase()),
    );
    this.identityHeaderNames = new Set(
      [...configuredIdentityHeaders, ...this.propagate]
        .map((header) => header.toLowerCase())
        .filter((header) => header !== AUTHORIZATION_HEADER && header !== INTERNAL_SECRET_HEADER),
    );
    this.trustedOrigins = new Set((cfg.trustedOrigins ?? []).map((origin) => this.normalizeTrustedOrigin(origin)));

    this.client.interceptors.request.use((config) => {
      const targetOrigin = this.requestOrigin(config);
      const headers = AxiosHeaders.from(config.headers);
      config.headers = headers;
      headers.delete([...this.identityHeaderNames]);
      if (!targetOrigin || !this.trustedOrigins.has(targetOrigin)) {
        headers.delete(INTERNAL_SECRET_HEADER);
      } else {
        this.populateAxiosIdentityHeaders(headers);
      }
      this.installRedirectPolicy(config);
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

  private normalizeTrustedOrigin(value: string): string {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error(`HttpClientConfig.trustedOrigins supports only HTTP(S) origins: ${value}`);
    }
    return url.origin;
  }

  private requestOrigin(config: AxiosRequestConfig): string | undefined {
    if (!config.url) return undefined;
    try {
      const url = config.baseURL ? new URL(config.url, config.baseURL) : new URL(config.url);
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : undefined;
    } catch {
      return undefined;
    }
  }

  private installRedirectPolicy(config: AxiosRequestConfig): void {
    const consumerHook = config.beforeRedirect;
    config.beforeRedirect = (options, responseDetails, requestDetails) => {
      consumerHook?.(options, responseDetails, requestDetails);
      const origin = this.redirectOrigin(options as Record<string, unknown>);
      const headers = options.headers;
      if (!headers || typeof headers !== 'object') return;
      const record = headers as Record<string, unknown>;
      this.stripRecordHeaders(record, this.identityHeaderNames);
      if (!origin || !this.trustedOrigins.has(origin)) {
        this.stripRecordHeaders(record, new Set([INTERNAL_SECRET_HEADER]));
      } else {
        this.populateRecordIdentityHeaders(record);
      }
    };
  }

  private redirectOrigin(options: Record<string, unknown>): string | undefined {
    try {
      if (typeof options.href === 'string') return new URL(options.href).origin;
      const protocol = typeof options.protocol === 'string' ? options.protocol : undefined;
      const hostname = typeof options.hostname === 'string' ? options.hostname : undefined;
      const host = typeof options.host === 'string' ? options.host : undefined;
      const port = typeof options.port === 'string' || typeof options.port === 'number' ? String(options.port) : undefined;
      if (!protocol || (!hostname && !host)) return undefined;
      const authority = hostname ? `${hostname}${port ? `:${port}` : ''}` : host!;
      const url = new URL(`${protocol}//${authority}`);
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : undefined;
    } catch {
      return undefined;
    }
  }

  private populateAxiosIdentityHeaders(headers: AxiosHeaders): void {
    const ctx = this.context?.store;
    if (!ctx) return;
    const contextHeaders = this.contextHeaderMap(ctx as unknown as Record<string, unknown>);
    for (const headerName of this.propagate) {
      const value = contextHeaders[headerName];
      if (value !== undefined) headers.set(headerName, value);
    }
  }

  private populateRecordIdentityHeaders(headers: Record<string, unknown>): void {
    const ctx = this.context?.store;
    if (!ctx) return;
    const contextHeaders = this.contextHeaderMap(ctx as unknown as Record<string, unknown>);
    for (const headerName of this.propagate) {
      const value = contextHeaders[headerName];
      if (value !== undefined) headers[headerName] = value;
    }
  }

  private stripRecordHeaders(headers: Record<string, unknown>, names: ReadonlySet<string>): void {
    for (const headerName of Object.keys(headers)) {
      if (names.has(headerName.toLowerCase())) delete headers[headerName];
    }
  }
}
