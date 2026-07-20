# Cache and HTTP

This compatibility page points to the expanded guides:

- [Cache](/guide/cache): backend configuration, mandatory `CacheInterceptor` registration, cache
  scopes, Redis namespaces, and explicit `CacheService` use.
- [Outbound HTTP](/guide/outbound-http): exact trusted origins, identity propagation, redirects, and
  client examples.

Both features depend on request identity. Read [Request context](/guide/request-context) before
sharing cached values or propagating headers across services.
