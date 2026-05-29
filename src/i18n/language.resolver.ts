import type { ILanguageResolver } from './i18n.types';

export interface LanguageResolverOptions {
  /** Supported base locale codes, e.g. `['en', 'vi']`. */
  supported: string[];
  /** Returned when nothing in the header matches a supported code. */
  fallback: string;
}

/**
 * Parses an `Accept-Language`-style header into one supported base locale code.
 *
 * - Splits on `,`, reads each tag's `;q=` weight (default `1`), sorts by weight desc.
 * - Strips region (`vi-VN` → `vi`) and lowercases.
 * - Returns the first tag present in `supported`, else `fallback`.
 */
export class DefaultLanguageResolver implements ILanguageResolver {
  constructor(private readonly opts: LanguageResolverOptions) {}

  resolve(raw: string | undefined): string {
    if (!raw) return this.opts.fallback;
    const ranked = raw
      .split(',')
      .map((part) => {
        const [tag, q] = part.trim().split(';q=');
        const base = tag.split('-')[0].trim().toLowerCase();
        const weight = q !== undefined ? Number.parseFloat(q) : 1;
        return { base, weight: Number.isNaN(weight) ? 0 : weight };
      })
      .filter((t) => t.base.length > 0)
      .sort((a, b) => b.weight - a.weight);

    for (const { base } of ranked) {
      if (this.opts.supported.includes(base)) return base;
    }
    return this.opts.fallback;
  }
}
