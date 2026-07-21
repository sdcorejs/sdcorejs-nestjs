import type { HeadConfig } from 'vitepress';

export const DOCS_BASE = '/sdcorejs-nestjs/';
export const DOCS_URL = 'https://sdcorejs.github.io/sdcorejs-nestjs/';

export type DocsLocale = 'en' | 'vi';

const socialImageAlt: Record<DocsLocale, string> = {
  en: 'SDCoreJS logo and wordmark',
  vi: 'Biểu trưng và tên thương hiệu SDCoreJS',
};

export const BRANDING = {
  name: 'SDCoreJS',
  navTitle: 'NestJS',
  favicon: `${DOCS_BASE}images/sdcorejs-logo.png`,
  navLogo: '/images/sdcorejs-wordmark.png',
  heroLogo: '/images/sdcorejs-logo.png',
  socialImage: `${DOCS_URL}images/sdcorejs-lockup.png`,
  primaryColor: '#0848b8',
} as const;

export function createBrandHead(): HeadConfig[] {
  return [
    ['link', { rel: 'icon', type: 'image/png', sizes: '368x368', href: BRANDING.favicon }],
    ['link', { rel: 'apple-touch-icon', href: BRANDING.favicon }],
    ['meta', { name: 'application-name', content: `${BRANDING.name} ${BRANDING.navTitle}` }],
    ['meta', { name: 'theme-color', content: BRANDING.primaryColor }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:site_name', content: BRANDING.name }],
    ['meta', { property: 'og:locale', content: 'en_US' }],
    ['meta', { property: 'og:image', content: BRANDING.socialImage }],
    ['meta', { property: 'og:image:type', content: 'image/png' }],
    ['meta', { property: 'og:image:width', content: '866' }],
    ['meta', { property: 'og:image:height', content: '368' }],
    ['meta', { property: 'og:image:alt', content: socialImageAlt.en }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['meta', { name: 'twitter:image', content: BRANDING.socialImage }],
    ['meta', { name: 'twitter:image:alt', content: socialImageAlt.en }],
  ];
}

export function createLocaleBrandHead(locale: DocsLocale): HeadConfig[] {
  return [
    ['meta', { property: 'og:locale', content: locale === 'vi' ? 'vi_VN' : 'en_US' }],
    ['meta', { property: 'og:image:alt', content: socialImageAlt[locale] }],
    ['meta', { name: 'twitter:image:alt', content: socialImageAlt[locale] }],
  ];
}
