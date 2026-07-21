import { JwtModule } from './jwt.module';

describe('JwtModule', () => {
  it('rejects ambiguous symmetric and JWKS verification modes', () => {
    expect(() => JwtModule.forRoot({ secret: 'secret', jwks: { allowedIssuerHosts: ['https://kc.example.com'] } })).toThrow(
      /mutually exclusive verification modes/,
    );
  });

  it('requires one verification mode when selecting the default strategy', () => {
    expect(() => JwtModule.forRoot({})).toThrow(/requires either JwtConfig\.secret or JwtConfig\.jwks/);
    expect(() => JwtModule.forRoot({ secret: '   ' })).toThrow(/secret must be a non-empty string/);
  });

  it('allows a custom strategy to own verification configuration', () => {
    class CustomStrategy {}
    expect(() => JwtModule.forRoot({}, { strategy: CustomStrategy })).not.toThrow();
  });
});
