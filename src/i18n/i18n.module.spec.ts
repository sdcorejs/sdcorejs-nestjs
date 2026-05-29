import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { I18nModule } from './i18n.module';
import { I18N_RESOLVER } from './tokens';
import type { II18nResolver } from './i18n.types';
import { CORE_CATALOG_VI } from './catalog';

describe('I18nModule.forRoot', () => {
  it('provides a resolver that translates built-in core codes', async () => {
    const mod = await Test.createTestingModule({
      imports: [I18nModule.forRoot({ useGlobalFilter: false })],
    }).compile();
    const resolver = mod.get<II18nResolver>(I18N_RESOLVER);
    expect(resolver.translate('core.permission.forbidden', 'vi')).toBe(CORE_CATALOG_VI['core.permission.forbidden']);
  });

  it('merges consumer catalogs over the built-ins (per language)', async () => {
    const mod = await Test.createTestingModule({
      imports: [
        I18nModule.forRoot({
          useGlobalFilter: false,
          catalogs: { vi: { 'app.hello': 'Xin chào {name}' } },
        }),
      ],
    }).compile();
    const resolver = mod.get<II18nResolver>(I18N_RESOLVER);
    // consumer code resolves
    expect(resolver.translate('app.hello', 'vi', { name: 'An' })).toBe('Xin chào An');
    // built-in core code still resolves (not clobbered)
    expect(resolver.translate('core.validation.failed', 'vi')).toBe(CORE_CATALOG_VI['core.validation.failed']);
  });

  it('lets a consumer override a built-in code', async () => {
    const mod = await Test.createTestingModule({
      imports: [
        I18nModule.forRoot({
          useGlobalFilter: false,
          catalogs: { en: { 'core.permission.forbidden': 'Access denied' } },
        }),
      ],
    }).compile();
    const resolver = mod.get<II18nResolver>(I18N_RESOLVER);
    expect(resolver.translate('core.permission.forbidden', 'en')).toBe('Access denied');
  });
});
