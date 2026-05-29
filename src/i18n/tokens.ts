/** DI token for the `II18nResolver` used by `SdI18nExceptionFilter`. */
export const I18N_RESOLVER = Symbol('I18N_RESOLVER');

/** DI token for the `ILanguageResolver` used by the resolver to normalize the raw lang header. */
export const LANGUAGE_RESOLVER = Symbol('LANGUAGE_RESOLVER');
