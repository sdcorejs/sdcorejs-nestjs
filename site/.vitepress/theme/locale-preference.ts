export const DOCS_LOCALE_STORAGE_KEY = 'sdcorejs-nestjs-docs-locale';

export type DocsLocale = 'en' | 'vi';

export interface LocaleStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface LocaleRouter {
  route: { path: string };
  onAfterRouteChange?: (to: string) => void | PromiseLike<void>;
  /** @deprecated VitePress compatibility alias. */
  onAfterRouteChanged?: (to: string) => void | PromiseLike<void>;
}

export interface LocalePreferenceOptions {
  base?: string;
  currentPath?: string;
  replaceInitialPath?: (to: string) => void;
}

function splitPath(path: string): { pathname: string; suffix: string } {
  const suffixIndex = path.search(/[?#]/);
  return suffixIndex < 0 ? { pathname: path, suffix: '' } : { pathname: path.slice(0, suffixIndex), suffix: path.slice(suffixIndex) };
}

function normalizedBase(base: string): string {
  const withLeadingSlash = base.startsWith('/') ? base : `/${base}`;
  return `${withLeadingSlash.replace(/\/+$/, '')}/`.replace(/\/{2,}/g, '/');
}

function pathWithoutBase(path: string, base: string): { pathname: string; suffix: string } {
  const { pathname, suffix } = splitPath(path);
  const normalizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
  const basePath = normalizedBase(base);
  const basePrefix = basePath === '/' ? '' : basePath.slice(0, -1);
  if (basePrefix && (normalizedPath === basePrefix || normalizedPath.startsWith(`${basePrefix}/`))) {
    return { pathname: normalizedPath.slice(basePrefix.length) || '/', suffix };
  }
  return { pathname: normalizedPath || '/', suffix };
}

function isHomePath(path: string, base: string): boolean {
  const { pathname } = pathWithoutBase(path, base);
  return pathname === '/' || pathname === '/index' || pathname === '/index.html';
}

export function localeFromPath(path: string, base = '/'): DocsLocale {
  const { pathname } = pathWithoutBase(path, base);
  return pathname === '/vi' || pathname.startsWith('/vi/') ? 'vi' : 'en';
}

export function pathForLocale(path: string, locale: DocsLocale, base = '/'): string {
  const { pathname, suffix } = pathWithoutBase(path, base);
  let localizedPath: string;
  if (locale === 'vi') {
    localizedPath = pathname === '/vi' || pathname.startsWith('/vi/') ? pathname : pathname === '/' ? '/vi/' : `/vi${pathname}`;
  } else if (pathname === '/vi' || pathname === '/vi/') {
    localizedPath = '/';
  } else if (pathname.startsWith('/vi/')) {
    localizedPath = pathname.slice(3) || '/';
  } else {
    localizedPath = pathname;
  }

  const basePath = normalizedBase(base);
  const basePrefix = basePath === '/' ? '' : basePath.slice(0, -1);
  return `${basePrefix}${localizedPath}${suffix}`;
}

export function readStoredLocale(storage: LocaleStorage): DocsLocale | undefined {
  try {
    const value = storage.getItem(DOCS_LOCALE_STORAGE_KEY);
    return value === 'en' || value === 'vi' ? value : undefined;
  } catch {
    return undefined;
  }
}

export function persistLocale(storage: LocaleStorage, locale: DocsLocale): void {
  try {
    storage.setItem(DOCS_LOCALE_STORAGE_KEY, locale);
  } catch {
    // Storage can be unavailable in privacy modes. Navigation must remain functional.
  }
}

/** Install locale persistence after VitePress creates its client-side router. */
export function installLocalePreference(
  router: LocaleRouter,
  storage: LocaleStorage,
  options: LocalePreferenceOptions = {},
): string | undefined {
  const base = options.base ?? '/';
  const previousAfterRouteChange = router.onAfterRouteChange ?? router.onAfterRouteChanged;
  router.onAfterRouteChange = async (to) => {
    try {
      await previousAfterRouteChange?.(to);
    } finally {
      // VitePress invokes this hook for both normal navigation and browser Back/Forward.
      persistLocale(storage, localeFromPath(to, base));
    }
  };

  // enhanceApp runs before VitePress's first router.go(), so route.path is still '/'. Use the
  // browser URL supplied by the theme to avoid misclassifying base-prefixed initial routes.
  const currentPath = options.currentPath ?? router.route.path;
  const currentLocale = localeFromPath(currentPath, base);
  const storedLocale = readStoredLocale(storage);

  // An explicit Vietnamese URL wins over a stale English preference and becomes the new choice.
  if (currentLocale === 'vi') {
    persistLocale(storage, 'vi');
    return undefined;
  }

  // With no saved choice, English is the default. Restore Vietnamese only at the neutral home
  // route; an explicit deep link remains authoritative and becomes the new preference. Replacing
  // browser history before VitePress's initial router.go() avoids a competing navigation race.
  if (storedLocale === 'vi' && isHomePath(currentPath, base)) {
    const target = pathForLocale(currentPath, 'vi', base);
    options.replaceInitialPath?.(target);
    return target;
  }

  persistLocale(storage, 'en');
  return undefined;
}
