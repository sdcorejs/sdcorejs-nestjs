import { ExtractJwt, type JwtFromRequestFunction } from 'passport-jwt';

/** Build the shared bearer-first, cookie-fallback extractor used by both verification modes. */
export function createJwtFromRequest(cookieName?: string): JwtFromRequestFunction {
  const extractors: JwtFromRequestFunction[] = [ExtractJwt.fromAuthHeaderAsBearerToken()];
  const normalizedCookieName = cookieName?.trim();
  if (normalizedCookieName) {
    extractors.push((request: { cookies?: Record<string, unknown> }) => {
      const value = request?.cookies?.[normalizedCookieName];
      return typeof value === 'string' && value.length > 0 ? value : null;
    });
  }
  return ExtractJwt.fromExtractors(extractors);
}
