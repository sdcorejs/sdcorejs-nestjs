import 'reflect-metadata';
import { JwtStrategy } from './jwt.strategy';

const extractorOf = (strategy: JwtStrategy) =>
  (strategy as unknown as { _jwtFromRequest: (request: unknown) => string | null })._jwtFromRequest;

describe('JwtStrategy', () => {
  it('instantiates with secret-only config', () => {
    const s = new JwtStrategy({ secret: 'test-secret' });
    expect(s).toBeInstanceOf(JwtStrategy);
  });

  it('instantiates with full config (issuer, audience, cookieName)', () => {
    const s = new JwtStrategy({
      secret: 'test-secret',
      issuer: 'sdcore',
      audience: 'sdcore-clients',
      cookieName: 'access_token',
    });
    expect(s).toBeInstanceOf(JwtStrategy);
  });

  it('extracts a bearer token first and falls back to the configured cookie', () => {
    const extract = extractorOf(new JwtStrategy({ secret: 'secret', cookieName: ' access_token ' }));
    expect(extract({ headers: { authorization: 'Bearer from-header' }, cookies: { access_token: 'from-cookie' } })).toBe('from-header');
    expect(extract({ headers: {}, cookies: { access_token: 'from-cookie' } })).toBe('from-cookie');
    expect(extract({ headers: {}, cookies: { access_token: '' } })).toBeNull();
  });

  it('default validate returns payload unchanged', async () => {
    const s = new JwtStrategy({ secret: 'x' });
    const payload = { sub: 'u1', name: 'A' };
    expect(await s.validate(payload)).toBe(payload);
  });
});
