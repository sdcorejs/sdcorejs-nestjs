/** `code -> message template`. Templates may contain `{var}` placeholders interpolated from `data`. */
export type MessageCatalog = Record<string, string>;

/** `langCode -> MessageCatalog`. */
export type Catalogs = Record<string, MessageCatalog>;

/**
 * Translates an `apiError` `code` (+ optional `data`) to a localized string. `SdI18nExceptionFilter`
 * calls this with the RAW `ctx.lang` header value — the resolver is responsible for normalizing it
 * (typically via an injected `ILanguageResolver`). Bridge to `nestjs-i18n` / ICU here if desired.
 */
export interface II18nResolver {
  translate(code: string, lang: string | undefined, data?: Record<string, unknown>): string;
}

/** Normalizes a raw `Accept-Language` / header value into a single supported locale code. */
export interface ILanguageResolver {
  resolve(raw: string | undefined): string;
}
