import { defineConfig } from 'vitepress';

// https://vitepress.dev/reference/site-config
export default defineConfig({
  lang: 'en-US',
  title: '@sdcorejs/nestjs',
  description:
    'Neutral NestJS framework library: base classes, multi-tenancy, audit, permission, request context, cache, HTTP client, JWT — domain specifics injected via DI strategies.',
  // GitHub project pages live under /<repo>/ — must match the deployed path.
  base: '/sdcorejs-nestjs/',
  lastUpdated: true,
  cleanUrls: true,
  head: [['meta', { name: 'theme-color', content: '#e0234e' }]],
  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Features', link: '/guide/features' },
      {
        text: '1.0.0',
        items: [
          { text: 'npm', link: 'https://www.npmjs.com/package/@sdcorejs/nestjs' },
          { text: 'Changelog', link: 'https://github.com/sdcorejs/sdcorejs-nestjs/blob/main/CHANGELOG.md' },
        ],
      },
    ],
    sidebar: {
      '/guide/': [
        {
          text: 'Getting started',
          items: [{ text: 'Installation & quick start', link: '/guide/getting-started' }],
        },
        {
          text: 'Core concerns',
          items: [
            { text: 'Multi-tenancy', link: '/guide/multi-tenancy' },
            { text: 'Permissions', link: '/guide/permissions' },
            { text: 'JWT / Keycloak', link: '/guide/jwt-keycloak' },
            { text: 'Internal calls', link: '/guide/internal-calls' },
            { text: 'Request context', link: '/guide/request-context' },
            { text: 'ORM base classes', link: '/guide/orm-base-classes' },
            { text: 'Validation (Zod v4)', link: '/guide/validation' },
            { text: 'i18n errors', link: '/guide/i18n' },
          ],
        },
        {
          text: 'Feature modules',
          items: [{ text: 'Uploads · History · Jobs', link: '/guide/features' }],
        },
      ],
    },
    socialLinks: [{ icon: 'github', link: 'https://github.com/sdcorejs/sdcorejs-nestjs' }],
    search: { provider: 'local' },
    editLink: {
      pattern: 'https://github.com/sdcorejs/sdcorejs-nestjs/edit/main/site/:path',
      text: 'Edit this page on GitHub',
    },
    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2026 Trần Thuận Nghĩa',
    },
  },
});
