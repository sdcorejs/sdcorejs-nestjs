/** Raised when a Redis cache namespace is missing or unsafe for prefix-scoped scans. */
export class InvalidRedisCacheKeyPrefixError extends Error {
  readonly code = 'core.cache.invalid-redis-key-prefix';

  constructor() {
    super('Redis cache keyPrefix must be an explicit nonblank string without Redis glob metacharacters (*, ?, [, ], or \\)');
    this.name = 'InvalidRedisCacheKeyPrefixError';
  }
}
