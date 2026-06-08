export interface HttpClientConfig {
  baseURL?: string;
  /** Request timeout in ms. Default: 30_000. */
  timeout?: number;
  /** Context header names propagated outbound. Default: all default context headers. */
  propagateHeaders?: string[];
}

/** DI token for the resolved `HttpClientConfig`. */
export const HTTP_CLIENT_CONFIG = Symbol('HTTP_CLIENT_CONFIG');
