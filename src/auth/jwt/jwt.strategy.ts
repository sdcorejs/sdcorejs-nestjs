import { Inject, Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, type JwtFromRequestFunction, Strategy, type StrategyOptionsWithoutRequest } from 'passport-jwt';
import { JWT_CONFIG, type JwtConfig } from './types';

/**
 * Default passport-jwt strategy. Subclass + override `validate` to map payload → user object.
 * If `cookieName` is set in config, the strategy also extracts the token from that cookie.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(@Inject(JWT_CONFIG) cfg: JwtConfig) {
    if (!cfg.secret) {
      throw new Error("JwtConfig.secret is required for the symmetric JwtStrategy; use 'jwks' for OIDC/Keycloak.");
    }
    const extractors: JwtFromRequestFunction[] = [ExtractJwt.fromAuthHeaderAsBearerToken()];
    if (cfg.cookieName) {
      const cookieName = cfg.cookieName;
      extractors.push((req: { cookies?: Record<string, string> }) => req?.cookies?.[cookieName] ?? null);
    }
    const options: StrategyOptionsWithoutRequest = {
      jwtFromRequest: ExtractJwt.fromExtractors(extractors),
      ignoreExpiration: false,
      secretOrKey: cfg.secret,
    };
    if (cfg.issuer) options.issuer = cfg.issuer;
    if (cfg.audience) options.audience = cfg.audience;
    super(options);
  }

  async validate(payload: unknown): Promise<unknown> {
    return payload;
  }
}
