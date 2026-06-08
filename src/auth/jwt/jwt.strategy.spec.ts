import 'reflect-metadata';
import { JwtStrategy } from './jwt.strategy';

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

  it('default validate returns payload unchanged', async () => {
    const s = new JwtStrategy({ secret: 'x' });
    const payload = { sub: 'u1', name: 'A' };
    expect(await s.validate(payload)).toBe(payload);
  });
});
