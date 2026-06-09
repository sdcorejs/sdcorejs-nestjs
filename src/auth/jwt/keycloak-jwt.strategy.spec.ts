import 'reflect-metadata';

/**
 * jwks-rsa + jsonwebtoken are optional peer deps, lazily `require`d inside the strategy ctor.
 * Mock both so the test exercises the issuer/kid resolution + allowlist logic without network.
 */
const getSigningKey = jest.fn();
const jwksClientCtor = jest.fn(() => ({ getSigningKey }));
jest.mock('jwks-rsa', () => ({ JwksClient: jwksClientCtor }), { virtual: true });

const decode = jest.fn();
jest.mock('jsonwebtoken', () => ({ decode }), { virtual: true });

import { KeycloakJwtStrategy } from './keycloak-jwt.strategy';
import type { JwtConfig } from './types';

/** Reach the `secretOrKeyProvider` passport-jwt was constructed with. */
const providerOf = (cfg: JwtConfig) => {
  const captured: { fn?: (...a: unknown[]) => void } = {};
  // passport-jwt's Strategy stores opts; instead, intercept via the ctor option object.
  // Simplest: spy on JwksClient + drive the provider passport extracted. We re-create by reading
  // the private strategy options is brittle, so instead instantiate and pull from the instance.
  const strat = new KeycloakJwtStrategy(cfg) as unknown as {
    _secretOrKeyProvider: (req: unknown, token: string, done: (e: Error | null, key?: string) => void) => void;
  };
  captured.fn = strat._secretOrKeyProvider;
  return captured.fn;
};

describe('KeycloakJwtStrategy', () => {
  beforeEach(() => {
    getSigningKey.mockReset();
    jwksClientCtor.mockClear();
    decode.mockReset();
  });

  it('resolves the signing key from the token issuer JWKS endpoint', (done) => {
    decode.mockReturnValue({ header: { kid: 'k1' }, payload: { iss: 'https://kc/realms/a' } });
    getSigningKey.mockResolvedValue({ getPublicKey: () => 'PUBKEY' });

    const provider = providerOf({ jwks: { allowedIssuerHosts: ['https://kc'] } });
    provider({}, 'raw.token', (err, key) => {
      expect(err).toBeNull();
      expect(key).toBe('PUBKEY');
      expect(jwksClientCtor).toHaveBeenCalledWith(
        expect.objectContaining({ jwksUri: 'https://kc/realms/a/protocol/openid-connect/certs' }),
      );
      done();
    });
  });

  it('rejects a token missing iss/kid', (done) => {
    decode.mockReturnValue({ header: {}, payload: {} });
    const provider = providerOf({ jwks: { allowedIssuerHosts: ['https://kc'] } });
    provider({}, 'raw', (err, key) => {
      expect(err).toBeInstanceOf(Error);
      expect(key).toBeUndefined();
      done();
    });
  });

  it('rejects an issuer not in allowedIssuers (no network call)', (done) => {
    decode.mockReturnValue({ header: { kid: 'k1' }, payload: { iss: 'https://evil' } });
    const provider = providerOf({ jwks: { allowedIssuers: ['https://kc/realms/a'] } });
    provider({}, 'raw', (err) => {
      expect(err).toBeInstanceOf(Error);
      expect(getSigningKey).not.toHaveBeenCalled();
      done();
    });
  });

  it('caches one JwksClient per issuer', (done) => {
    decode.mockReturnValue({ header: { kid: 'k1' }, payload: { iss: 'https://kc/realms/a' } });
    getSigningKey.mockResolvedValue({ getPublicKey: () => 'PUBKEY' });
    const provider = providerOf({ jwks: { allowedIssuerHosts: ['https://kc'] } });
    provider({}, 't1', () => {
      provider({}, 't2', () => {
        expect(jwksClientCtor).toHaveBeenCalledTimes(1);
        done();
      });
    });
  });

  it('honours a custom jwksUriFromIssuer', (done) => {
    decode.mockReturnValue({ header: { kid: 'k1' }, payload: { iss: 'iss-x' } });
    getSigningKey.mockResolvedValue({ getPublicKey: () => 'P' });
    const provider = providerOf({ jwks: { allowedIssuers: ['iss-x'], jwksUriFromIssuer: (iss) => `${iss}/jwks.json` } });
    provider({}, 't', () => {
      expect(jwksClientCtor).toHaveBeenCalledWith(expect.objectContaining({ jwksUri: 'iss-x/jwks.json' }));
      done();
    });
  });

  it('default validate() returns the payload', async () => {
    decode.mockReturnValue({ header: { kid: 'k' }, payload: { iss: 'i' } });
    const strat = new KeycloakJwtStrategy({ jwks: { allowedIssuerHosts: ['https://kc'] } });
    await expect(strat.validate({ sub: 'u1' })).resolves.toEqual({ sub: 'u1' });
  });

  it('allowedIssuerHosts accepts ANY realm under a trusted host (dynamic multi-realm)', (done) => {
    decode.mockReturnValue({ header: { kid: 'k1' }, payload: { iss: 'https://kc/realms/tenant-99' } });
    getSigningKey.mockResolvedValue({ getPublicKey: () => 'P' });
    const provider = providerOf({ jwks: { allowedIssuerHosts: ['https://kc'] } });
    provider({}, 't', (err, key) => {
      expect(err).toBeNull();
      expect(key).toBe('P');
      done();
    });
  });

  it('allowedIssuerHosts rejects a realm on a DIFFERENT host', (done) => {
    decode.mockReturnValue({ header: { kid: 'k1' }, payload: { iss: 'https://evil/realms/x' } });
    const provider = providerOf({ jwks: { allowedIssuerHosts: ['https://kc'] } });
    provider({}, 't', (err) => {
      expect(err).toBeInstanceOf(Error);
      expect(getSigningKey).not.toHaveBeenCalled();
      done();
    });
  });

  it('issuerValidator predicate gates the issuer', (done) => {
    decode.mockReturnValue({ header: { kid: 'k1' }, payload: { iss: 'https://kc/realms/ok' } });
    getSigningKey.mockResolvedValue({ getPublicKey: () => 'P' });
    const provider = providerOf({ jwks: { issuerValidator: (iss) => iss.endsWith('/ok') } });
    provider({}, 't', (err, key) => {
      expect(err).toBeNull();
      expect(key).toBe('P');
      done();
    });
  });

  it('throws at construction when NO issuer policy is configured (secure by default)', () => {
    expect(() => new KeycloakJwtStrategy({ jwks: {} })).toThrow(/issuer policy/);
  });
});
