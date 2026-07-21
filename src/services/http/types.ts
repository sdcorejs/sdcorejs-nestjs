export interface HttpClientConfig {
  baseURL?: string;
  /** Request timeout in ms. Default: 30_000. */
  timeout?: number;
  /**
   * Exact HTTP(S) origins allowed to receive context identity headers. Default: `[]` (propagation
   * disabled). Paths are ignored after normalization; subdomains and lookalike origins never match.
   */
  trustedOrigins?: string[];
  /**
   * Context header names propagated to trusted origins. Default: all configured identity headers.
   * `authorization` remains caller-owned and `x-internal-secret` remains caller-supplied only for
   * exact trusted origins; both names are ignored here.
   */
  propagateHeaders?: string[];
}

/** DI token for the resolved `HttpClientConfig`. */
export const HTTP_CLIENT_CONFIG = Symbol('HTTP_CLIENT_CONFIG');
