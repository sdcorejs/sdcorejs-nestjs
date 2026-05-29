import 'reflect-metadata';
import { DefaultLanguageResolver } from './language.resolver';
import { SimpleI18nResolver } from './simple-i18n.resolver';
import { CORE_CATALOG_EN, CORE_CATALOG_VI } from './catalog';

describe('DefaultLanguageResolver', () => {
  const r = new DefaultLanguageResolver({ supported: ['en', 'vi'], fallback: 'en' });

  it('falls back when header missing', () => {
    expect(r.resolve(undefined)).toBe('en');
  });

  it('picks the highest-q supported base tag', () => {
    expect(r.resolve('vi-VN,vi;q=0.9,en;q=0.8')).toBe('vi');
    expect(r.resolve('fr-FR,fr;q=0.9,en;q=0.5')).toBe('en');
  });

  it('strips region and lowercases', () => {
    expect(r.resolve('EN-US')).toBe('en');
  });

  it('falls back when no supported tag present', () => {
    expect(r.resolve('de,fr;q=0.9')).toBe('en');
  });
});

describe('SimpleI18nResolver', () => {
  const resolver = new SimpleI18nResolver({
    catalogs: { en: CORE_CATALOG_EN, vi: CORE_CATALOG_VI },
    fallbackLang: 'en',
    languageResolver: new DefaultLanguageResolver({ supported: ['en', 'vi'], fallback: 'en' }),
  });

  it('translates a known code in the resolved language', () => {
    expect(resolver.translate('core.permission.forbidden', 'vi')).toBe(CORE_CATALOG_VI['core.permission.forbidden']);
    expect(resolver.translate('core.permission.forbidden', 'en-US')).toBe(CORE_CATALOG_EN['core.permission.forbidden']);
  });

  it('falls back to fallbackLang when the code is missing in target lang', () => {
    const r = new SimpleI18nResolver({
      catalogs: { en: { 'x.only.en': 'English only' }, vi: {} },
      fallbackLang: 'en',
      languageResolver: new DefaultLanguageResolver({ supported: ['en', 'vi'], fallback: 'en' }),
    });
    expect(r.translate('x.only.en', 'vi')).toBe('English only');
  });

  it('returns the code itself when unknown everywhere', () => {
    expect(resolver.translate('totally.unknown.code', 'en')).toBe('totally.unknown.code');
  });

  it('interpolates {var} from data', () => {
    const r = new SimpleI18nResolver({
      catalogs: { en: { 'x.min': 'Must be at least {minimum}' } },
      fallbackLang: 'en',
    });
    expect(r.translate('x.min', 'en', { minimum: 3 })).toBe('Must be at least 3');
  });

  it('leaves unmatched placeholders intact', () => {
    const r = new SimpleI18nResolver({
      catalogs: { en: { 'x.t': 'Hi {name}' } },
      fallbackLang: 'en',
    });
    expect(r.translate('x.t', 'en', {})).toBe('Hi {name}');
  });
});
