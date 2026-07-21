import {
  DOCS_LOCALE_STORAGE_KEY,
  installLocalePreference,
  localeFromPath,
  pathForLocale,
  readStoredLocale,
  type LocaleRouter,
  type LocaleStorage,
} from '../../site/.vitepress/theme/locale-preference';

const productionBase = '/sdcorejs-nestjs/';

function memoryStorage(initial?: string): LocaleStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set(DOCS_LOCALE_STORAGE_KEY, initial);
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

function routerAt(path: string): LocaleRouter & { go: jest.Mock<Promise<void>, [string]> } {
  return { route: { path }, go: jest.fn(async () => undefined) };
}

describe('documentation locale preference', () => {
  it.each([
    ['/', 'en'],
    ['/guide/installation', 'en'],
    ['/vi', 'vi'],
    ['/vi/', 'vi'],
    ['/vi/api/core/orm?query=x#save', 'vi'],
  ] as const)('detects %s as %s', (path, locale) => {
    expect(localeFromPath(path)).toBe(locale);
  });

  it('maps corresponding routes in both directions while preserving query and hash', () => {
    expect(pathForLocale('/', 'vi')).toBe('/vi/');
    expect(pathForLocale('/guide/installation?from=home#install', 'vi')).toBe('/vi/guide/installation?from=home#install');
    expect(pathForLocale('/vi/guide/installation?from=home#install', 'en')).toBe('/guide/installation?from=home#install');
    expect(pathForLocale('/vi/', 'en')).toBe('/');
  });

  it('recognizes and preserves the configured deployment base', () => {
    expect(localeFromPath('/sdcorejs-nestjs/vi/api/core/orm#save', productionBase)).toBe('vi');
    expect(pathForLocale('/sdcorejs-nestjs/guide/installation?from=home#install', 'vi', productionBase)).toBe(
      '/sdcorejs-nestjs/vi/guide/installation?from=home#install',
    );
    expect(pathForLocale('/sdcorejs-nestjs/vi/guide/installation#install', 'en', productionBase)).toBe(
      '/sdcorejs-nestjs/guide/installation#install',
    );
  });

  it('defaults to English and persists it when there is no saved choice', () => {
    const storage = memoryStorage();
    const router = routerAt('/guide/getting-started');

    installLocalePreference(router, storage);

    expect(router.go).not.toHaveBeenCalled();
    expect(readStoredLocale(storage)).toBe('en');
  });

  it('reopens the Vietnamese home page when Vietnamese was saved', () => {
    const storage = memoryStorage('vi');
    const router = routerAt('/?from=bookmark#install');
    const replaceInitialPath = jest.fn();

    const target = installLocalePreference(router, storage, { replaceInitialPath });

    expect(target).toBe('/vi/?from=bookmark#install');
    expect(replaceInitialPath).toHaveBeenCalledWith('/vi/?from=bookmark#install');
    expect(router.go).not.toHaveBeenCalled();
  });

  it('restores Vietnamese at the production base before the initial VitePress navigation', () => {
    const storage = memoryStorage('vi');
    const router = routerAt('/');
    const replaceInitialPath = jest.fn();

    const target = installLocalePreference(router, storage, {
      base: productionBase,
      currentPath: '/sdcorejs-nestjs/?from=bookmark#install',
      replaceInitialPath,
    });

    expect(target).toBe('/sdcorejs-nestjs/vi/?from=bookmark#install');
    expect(replaceInitialPath).toHaveBeenCalledWith('/sdcorejs-nestjs/vi/?from=bookmark#install');
    expect(router.go).not.toHaveBeenCalled();
  });

  it('treats an explicit English deep link as the new preference', () => {
    const storage = memoryStorage('vi');
    const router = routerAt('/api/core/orm');

    installLocalePreference(router, storage);

    expect(router.go).not.toHaveBeenCalled();
    expect(readStoredLocale(storage)).toBe('en');
  });

  it('treats an explicit Vietnamese URL as the new preference', () => {
    const storage = memoryStorage('en');
    const router = routerAt('/vi/examples/complete-app');

    installLocalePreference(router, storage);

    expect(router.go).not.toHaveBeenCalled();
    expect(readStoredLocale(storage)).toBe('vi');
  });

  it('uses the real browser path before VitePress initializes route.path', () => {
    const storage = memoryStorage('en');
    const router = routerAt('/');

    installLocalePreference(router, storage, {
      base: productionBase,
      currentPath: '/sdcorejs-nestjs/vi/examples/complete-app',
    });

    expect(readStoredLocale(storage)).toBe('vi');
  });

  it('treats a base-prefixed English deep link as authoritative before route initialization', () => {
    const storage = memoryStorage('vi');
    const router = routerAt('/');

    installLocalePreference(router, storage, {
      base: productionBase,
      currentPath: '/sdcorejs-nestjs/api/core/orm',
    });

    expect(readStoredLocale(storage)).toBe('en');
  });

  it('updates storage after locale navigation and preserves an existing router hook', async () => {
    const storage = memoryStorage('en');
    const router = routerAt('/guide/installation');
    const previous = jest.fn(async () => undefined);
    router.onAfterRouteChange = previous;
    installLocalePreference(router, storage);

    await router.onAfterRouteChange?.('/vi/guide/installation');
    expect(previous).toHaveBeenCalledWith('/vi/guide/installation');
    expect(readStoredLocale(storage)).toBe('vi');

    await router.onAfterRouteChange?.('/guide/installation');
    expect(readStoredLocale(storage)).toBe('en');
  });

  it('tracks base-prefixed locale navigation from the production router', async () => {
    const storage = memoryStorage('en');
    const router = routerAt('/');
    installLocalePreference(router, storage, {
      base: productionBase,
      currentPath: '/sdcorejs-nestjs/',
    });

    await router.onAfterRouteChange?.('/sdcorejs-nestjs/vi/guide/installation');
    expect(readStoredLocale(storage)).toBe('vi');

    await router.onAfterRouteChange?.('/sdcorejs-nestjs/guide/installation');
    expect(readStoredLocale(storage)).toBe('en');
  });

  it('preserves VitePress legacy after-route hooks', async () => {
    const storage = memoryStorage('en');
    const router = routerAt('/guide/installation');
    const previous = jest.fn(async () => undefined);
    router.onAfterRouteChanged = previous;
    installLocalePreference(router, storage);

    await router.onAfterRouteChange?.('/vi/guide/installation');
    expect(previous).toHaveBeenCalledWith('/vi/guide/installation');
    expect(readStoredLocale(storage)).toBe('vi');
  });

  it('keeps navigation usable when browser storage throws', () => {
    const storage: LocaleStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    const router = routerAt('/');

    expect(() => installLocalePreference(router, storage)).not.toThrow();
    expect(router.go).not.toHaveBeenCalled();
  });
});
