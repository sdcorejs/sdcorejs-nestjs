/** DI token for the resolved {@link HeadersConfig} (defaults merged with user overrides). */
export const CONTEXT_HEADERS_CONFIG = Symbol('CONTEXT_HEADERS_CONFIG');

/** DI token for verified-principal and explicitly trusted-header identity configuration. */
export const CONTEXT_IDENTITY_CONFIG = Symbol('CONTEXT_IDENTITY_CONFIG');
