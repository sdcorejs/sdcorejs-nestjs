import { Inject, Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, type SecretOrKeyProvider, Strategy, type StrategyOptionsWithoutRequest } from 'passport-jwt';
import { JWT_CONFIG, type JwtConfig, type JwtPayload } from './types';

/** Minimal slice of a jwks-rsa client we depend on — kept loose so the type graph stays clean. */
interface JwksClientLike {
  getSigningKey(kid: string): Promise<{ getPublicKey(): string }>;
}
type JwksClientCtor = new (opts: Record<string, unknown>) => JwksClientLike;

const DEFAULT_JWKS_URI = (iss: string): string => `${iss}/protocol/openid-connect/certs`;

/** Lazily resolve an optional peer dep, with a friendly install hint when missing. */
function lazy<T>(name: string): T {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require(name) as T;
  } catch {
    throw new Error(`@sdcorejs/nestjs JWKS auth requires the '${name}' package. Install it: npm i ${name}`);
  }
}

/**
 * passport-jwt strategy that verifies RS256 tokens against the issuer's JWKS endpoint (Keycloak /
 * any OIDC provider). The signing key is resolved per token from its `iss` + `kid`, so multiple
 * realms / tenants are supported without a shared secret. A `JwksClient` is cached per issuer.
 *
 * Subclass and override `validate(payload)` to enrich the request user (the base returns the raw
 * payload). Requires the optional peer deps `jwks-rsa` and `jsonwebtoken`.
 *
 * @example
 * @Injectable()
 * export class AppJwtStrategy extends KeycloakJwtStrategy {
 *   constructor(@Inject(JWT_CONFIG) cfg: JwtConfig, private users: UserService) { super(cfg); }
 *   async validate(payload: JwtPayload) {
 *     const user = await this.users.byKeycloakId(payload.sub);
 *     if (!user) throw new UnauthorizedException();
 *     return user;
 *   }
 * }
 */
@Injectable()
export class KeycloakJwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(@Inject(JWT_CONFIG) cfg: JwtConfig) {
    const jwks = cfg.jwks ?? {};
    const JwksClient = lazy<{ JwksClient: JwksClientCtor }>('jwks-rsa').JwksClient;
    const jwt = lazy<{ decode(token: string, opts: { complete: true }): unknown }>('jsonwebtoken');

    const uriFromIssuer = jwks.jwksUriFromIssuer ?? DEFAULT_JWKS_URI;
    const allowed = jwks.allowedIssuers;
    // Normalize allowedIssuerHosts to bare origins (strip trailing slash / path / port defaults) so
    // `https://kc.example.com/` and `https://kc.example.com` both match `new URL(iss).origin`.
    const allowedHosts = jwks.allowedIssuerHosts?.map((h) => {
      try {
        return new URL(h).origin;
      } catch {
        return h; // not a URL — keep as-is, validator / exact match only
      }
    });
    const issuerValidator = jwks.issuerValidator;
    const cache = jwks.cache ?? true;
    const rateLimit = jwks.rateLimit ?? true;

    // Secure by default: a JWKS strategy MUST declare which issuers it trusts. Without a policy the
    // signing key would be fetched from any token-supplied `iss` URL (issuer-spoof + SSRF). For
    // dynamic multi-realm, set `allowedIssuerHosts` to pin the Keycloak origin (any realm under it).
    if (!allowed?.length && !allowedHosts?.length && !issuerValidator) {
      throw new Error(
        'KeycloakJwtStrategy requires an issuer policy: set jwks.allowedIssuers, jwks.allowedIssuerHosts, or jwks.issuerValidator',
      );
    }

    const isIssuerAllowed = (iss: string): boolean => {
      if (allowed?.includes(iss)) return true;
      if (allowedHosts?.length) {
        try {
          if (allowedHosts.includes(new URL(iss).origin)) return true;
        } catch {
          /* not a URL → only an exact allowedIssuers / validator match can accept it */
        }
      }
      return issuerValidator ? issuerValidator(iss) : false;
    };

    // LRU-bounded client cache (max 100 entries). Map preserves insertion order; on overflow the
    // oldest entry is evicted. `allowedIssuerHosts` can accept any realm under the trusted host
    // so without a cap an attacker could exhaust memory with distinct iss URLs before verification.
    const MAX_CLIENTS = 100;
    const clientMap = new Map<string, JwksClientLike>();
    const clients = {
      get: (iss: string) => clientMap.get(iss),
      set: (iss: string, client: JwksClientLike) => {
        if (clientMap.size >= MAX_CLIENTS) {
          // evict least-recently-inserted (Map.keys() is insertion-ordered)
          const oldest = clientMap.keys().next().value;
          if (oldest !== undefined) clientMap.delete(oldest);
        }
        clientMap.set(iss, client);
      },
    };

    const secretOrKeyProvider: SecretOrKeyProvider = (_req, rawToken, done) => {
      try {
        const decoded = jwt.decode(rawToken, { complete: true }) as { header?: { kid?: string }; payload?: { iss?: string } } | null;
        const iss = decoded?.payload?.iss;
        const kid = decoded?.header?.kid;
        if (!iss || !kid) return done(new Error('Invalid token: missing iss/kid'), undefined);
        if (!isIssuerAllowed(iss)) return done(new Error(`Issuer not allowed: ${iss}`), undefined);

        let client = clients.get(iss);
        if (!client) {
          client = new JwksClient({ jwksUri: uriFromIssuer(iss), cache, rateLimit });
          clients.set(iss, client);
        }
        client
          .getSigningKey(kid)
          .then((key) => done(null, key.getPublicKey()))
          .catch((err: Error) => done(err, undefined));
      } catch (err) {
        done(err as Error, undefined);
      }
    };

    const options: StrategyOptionsWithoutRequest = {
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      algorithms: (jwks.algorithms ?? ['RS256']) as StrategyOptionsWithoutRequest['algorithms'],
      secretOrKeyProvider,
    };
    if (cfg.issuer) options.issuer = cfg.issuer;
    if (cfg.audience) options.audience = cfg.audience;
    super(options);
  }

  /** Default: return the verified payload as `req.user`. Override to enrich (DB / BE lookup). */
  async validate(payload: JwtPayload): Promise<unknown> {
    return payload;
  }
}
