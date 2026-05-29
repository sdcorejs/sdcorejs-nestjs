import { type DynamicModule, Module, type Provider, type Type } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { CORE_CATALOGS } from './catalog';
import type { Catalogs, II18nResolver } from './i18n.types';
import { SdI18nExceptionFilter } from './i18n.exception.filter';
import { DefaultLanguageResolver } from './language.resolver';
import { SimpleI18nResolver } from './simple-i18n.resolver';
import { I18N_RESOLVER, LANGUAGE_RESOLVER } from './tokens';

export interface I18nModuleOptions {
  /** Catalogs merged OVER the built-in en/vi `core.*` messages (per language, consumer wins). */
  catalogs?: Catalogs;
  /** Supported base locale codes. Default `['en', 'vi']`. */
  supportedLanguages?: string[];
  /** Locale used when nothing matches. Default `'en'`. */
  fallbackLanguage?: string;
  /** Provide a fully custom `II18nResolver` (e.g. an ICU / nestjs-i18n bridge). Overrides the
   * built-in `SimpleI18nResolver`. */
  resolver?: Type<II18nResolver>;
  /** Register `SdI18nExceptionFilter` as a global `APP_FILTER`. Default `true`. */
  useGlobalFilter?: boolean;
}

/** Per-language shallow merge: built-ins first, then consumer overrides. */
export function mergeCatalogs(base: Catalogs, extra?: Catalogs): Catalogs {
  if (!extra) return { ...base };
  const out: Catalogs = { ...base };
  for (const [lang, catalog] of Object.entries(extra)) {
    out[lang] = { ...(out[lang] ?? {}), ...catalog };
  }
  return out;
}

@Module({})
export class I18nModule {
  static forRoot(options: I18nModuleOptions = {}): DynamicModule {
    const supported = options.supportedLanguages ?? ['en', 'vi'];
    const fallback = options.fallbackLanguage ?? 'en';
    const catalogs = mergeCatalogs(CORE_CATALOGS, options.catalogs);

    const languageProvider: Provider = {
      provide: LANGUAGE_RESOLVER,
      useValue: new DefaultLanguageResolver({ supported, fallback }),
    };

    const resolverProvider: Provider = options.resolver
      ? { provide: I18N_RESOLVER, useClass: options.resolver }
      : {
          provide: I18N_RESOLVER,
          useFactory: (lang: DefaultLanguageResolver) =>
            new SimpleI18nResolver({ catalogs, fallbackLang: fallback, languageResolver: lang }),
          inject: [LANGUAGE_RESOLVER],
        };

    const providers: Provider[] = [languageProvider, resolverProvider];
    if (options.useGlobalFilter !== false) {
      providers.push({ provide: APP_FILTER, useClass: SdI18nExceptionFilter });
    }

    return {
      module: I18nModule,
      global: true,
      providers,
      exports: [I18N_RESOLVER, LANGUAGE_RESOLVER],
    };
  }
}
