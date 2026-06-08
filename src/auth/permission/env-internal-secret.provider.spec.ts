import { EnvInternalSecretProvider } from './internal-secret.provider';

describe('EnvInternalSecretProvider', () => {
  afterEach(() => {
    delete process.env.TEST_SECRET;
  });
  it('reads the configured env var, empty when unset', () => {
    const p = new EnvInternalSecretProvider('TEST_SECRET');
    expect(p.getKey()).toBe('');
    process.env.TEST_SECRET = 's3cr3t';
    expect(p.getKey()).toBe('s3cr3t');
  });
});
