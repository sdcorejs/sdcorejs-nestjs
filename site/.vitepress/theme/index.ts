import { inBrowser, type Theme } from 'vitepress';
import DefaultTheme from 'vitepress/theme';
import { installLocalePreference } from './locale-preference';

export default {
  extends: DefaultTheme,
  enhanceApp({ router, siteData }) {
    if (!inBrowser) return;
    try {
      installLocalePreference(router, window.localStorage, {
        base: siteData.value.base,
        currentPath: `${window.location.pathname}${window.location.search}${window.location.hash}`,
        replaceInitialPath: (to) => window.history.replaceState(window.history.state, '', to),
      });
    } catch {
      // Accessing localStorage itself can throw in restricted browser contexts.
    }
  },
} satisfies Theme;
