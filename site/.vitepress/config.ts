import { defineConfig, type DefaultTheme } from 'vitepress';
import { createNav, createSidebar } from './navigation.mjs';

const search: DefaultTheme.Config['search'] = {
  provider: 'local',
  options: {
    locales: {
      vi: {
        translations: {
          button: {
            buttonText: 'Tìm kiếm',
            buttonAriaLabel: 'Tìm kiếm tài liệu',
          },
          modal: {
            displayDetails: 'Hiển thị danh sách chi tiết',
            resetButtonTitle: 'Xóa truy vấn',
            backButtonTitle: 'Đóng tìm kiếm',
            noResultsText: 'Không tìm thấy kết quả',
            footer: {
              selectText: 'chọn',
              selectKeyAriaLabel: 'Enter',
              navigateText: 'di chuyển',
              navigateUpKeyAriaLabel: 'Mũi tên lên',
              navigateDownKeyAriaLabel: 'Mũi tên xuống',
              closeText: 'đóng',
              closeKeyAriaLabel: 'Escape',
            },
          },
        },
      },
    },
  },
};

const englishTheme: DefaultTheme.Config = {
  nav: createNav('en'),
  sidebar: createSidebar('en'),
  socialLinks: [{ icon: 'github', link: 'https://github.com/sdcorejs/sdcorejs-nestjs' }],
  search,
  i18nRouting: true,
  outline: { level: [2, 3], label: 'On this page' },
  editLink: {
    pattern: 'https://github.com/sdcorejs/sdcorejs-nestjs/edit/main/site/:path',
    text: 'Edit this page on GitHub',
  },
  lastUpdated: { text: 'Last updated' },
  docFooter: { prev: 'Previous page', next: 'Next page' },
  darkModeSwitchLabel: 'Appearance',
  lightModeSwitchTitle: 'Switch to light theme',
  darkModeSwitchTitle: 'Switch to dark theme',
  sidebarMenuLabel: 'Menu',
  returnToTopLabel: 'Return to top',
  langMenuLabel: 'Change language',
  skipToContentLabel: 'Skip to content',
  notFound: {
    title: 'PAGE NOT FOUND',
    quote: 'The requested documentation page does not exist.',
    linkLabel: 'go to home',
    linkText: 'Take me home',
  },
  footer: {
    message: 'Released under the MIT License.',
    copyright: 'Copyright © 2026 Trần Thuận Nghĩa',
  },
};

const vietnameseTheme: DefaultTheme.Config = {
  nav: createNav('vi'),
  sidebar: createSidebar('vi'),
  outline: { level: [2, 3], label: 'Trong trang này' },
  editLink: {
    pattern: 'https://github.com/sdcorejs/sdcorejs-nestjs/edit/main/site/:path',
    text: 'Chỉnh sửa trang này trên GitHub',
  },
  lastUpdated: { text: 'Cập nhật lần cuối' },
  docFooter: { prev: 'Trang trước', next: 'Trang tiếp theo' },
  darkModeSwitchLabel: 'Giao diện',
  lightModeSwitchTitle: 'Chuyển sang giao diện sáng',
  darkModeSwitchTitle: 'Chuyển sang giao diện tối',
  sidebarMenuLabel: 'Menu',
  returnToTopLabel: 'Về đầu trang',
  langMenuLabel: 'Đổi ngôn ngữ',
  skipToContentLabel: 'Chuyển đến nội dung',
  notFound: {
    title: 'KHÔNG TÌM THẤY TRANG',
    quote: 'Trang tài liệu bạn yêu cầu không tồn tại.',
    linkLabel: 'về trang chủ',
    linkText: 'Về trang chủ',
  },
  footer: {
    message: 'Phát hành theo giấy phép MIT.',
    copyright: 'Bản quyền © 2026 Trần Thuận Nghĩa',
  },
};

export default defineConfig({
  lang: 'en-US',
  title: '@sdcorejs/nestjs',
  description:
    'Production-oriented NestJS and TypeORM building blocks with fail-closed tenancy, identity, caching, files, jobs, and audit history.',
  base: '/sdcorejs-nestjs/',
  lastUpdated: true,
  cleanUrls: true,
  head: [['meta', { name: 'theme-color', content: '#e0234e' }]],
  locales: {
    root: {
      label: 'English',
      lang: 'en-US',
      link: '/',
    },
    vi: {
      label: 'Tiếng Việt',
      lang: 'vi-VN',
      link: '/vi/',
      description:
        'Các khối xây dựng NestJS và TypeORM hướng production với tenancy fail-closed, danh tính tin cậy, cache, tệp, tác vụ và lịch sử audit.',
      themeConfig: vietnameseTheme,
    },
  },
  themeConfig: englishTheme,
});
