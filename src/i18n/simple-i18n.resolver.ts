import type { Catalogs, II18nResolver, ILanguageResolver } from './types';

export interface SimpleI18nOptions {
  /** `langCode -> code -> template`. */
  catalogs: Catalogs;
  /** Language used when the target lang has no entry for a code. */
  fallbackLang: string;
  /** Normalizes the raw lang header. When omitted, the raw value is used as the lookup key. */
  languageResolver?: ILanguageResolver;
}

/** Replace `{var}` placeholders from `data`; leave unmatched placeholders intact. */
function interpolate(template: string, data?: Record<string, unknown>): string {
  if (!data) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in data ? String(data[key]) : match));
}

/**
 * Catalog-backed `II18nResolver`. Lookup order: `catalogs[lang][code]` → `catalogs[fallbackLang][code]`
 * → the `code` itself (so an unknown code degrades to a stable string, never throws). Interpolates
 * `{var}` placeholders from `data`. For ICU / plural rules, implement a custom `II18nResolver` instead.
 */
export class SimpleI18nResolver implements II18nResolver {
  constructor(private readonly opts: SimpleI18nOptions) {}

  translate(code: string, lang: string | undefined, data?: Record<string, unknown>): string {
    const langCode = this.opts.languageResolver ? this.opts.languageResolver.resolve(lang) : (lang ?? this.opts.fallbackLang);

    const template = this.opts.catalogs[langCode]?.[code] ?? this.opts.catalogs[this.opts.fallbackLang]?.[code] ?? code;

    return interpolate(template, data);
  }
}
