/** @typedef {'en' | 'vi'} DocsLocale */

/** @param {DocsLocale} locale @param {string} path */
const localizedPath = (locale, path) => (locale === 'vi' ? `/vi${path}` : path);

/** @param {DocsLocale} locale @param {string} text @param {string} path */
const item = (locale, text, path) => ({ text, link: localizedPath(locale, path) });

/** @param {DocsLocale} locale @returns {import('vitepress').DefaultTheme.NavItem[]} */
export function createNav(locale) {
  const vi = locale === 'vi';
  return [
    item(locale, vi ? 'Hướng dẫn' : 'Guide', '/guide/'),
    item(locale, vi ? 'Ví dụ' : 'Examples', '/examples/'),
    item(locale, 'API', '/api/'),
    item(locale, vi ? 'Bảo mật' : 'Security', '/reference/security'),
    {
      text: vi ? 'Bản phát hành' : 'Releases',
      items: [
        item(locale, vi ? 'Điểm mới trong 1.1.0' : 'What is new in 1.1.0', '/releases/1.1.0'),
        item(locale, vi ? 'Nâng cấp 1.0 → 1.1' : 'Upgrade 1.0 → 1.1', '/migrations/1.0-to-1.1'),
        item(locale, vi ? 'Chuyển từ core-be' : 'Migrate from core-be', '/migrations/from-core-be'),
        item(locale, vi ? 'Nhật ký thay đổi' : 'Changelog', '/releases/changelog'),
      ],
    },
    { text: 'npm', link: 'https://www.npmjs.com/package/@sdcorejs/nestjs' },
  ];
}

/** @param {DocsLocale} locale @returns {import('vitepress').DefaultTheme.SidebarItem[]} */
export function createSidebar(locale) {
  const vi = locale === 'vi';
  return [
    {
      text: vi ? 'Bắt đầu' : 'Start here',
      items: [
        item(locale, vi ? 'Tổng quan hướng dẫn' : 'Guide overview', '/guide/'),
        item(locale, vi ? 'Bắt đầu nhanh' : 'Getting started', '/guide/getting-started'),
        item(locale, vi ? 'Cài đặt' : 'Installation', '/guide/installation'),
        item(locale, vi ? 'Cấu hình' : 'Configuration', '/guide/configuration'),
        item(locale, vi ? 'Yêu cầu cơ sở dữ liệu' : 'Database requirements', '/guide/database'),
        item(locale, vi ? 'Kiến trúc' : 'Architecture', '/guide/architecture'),
      ],
    },
    {
      text: vi ? 'Hướng dẫn cốt lõi' : 'Core guides',
      collapsed: true,
      items: [
        item(locale, vi ? 'Ngữ cảnh request' : 'Request context', '/guide/request-context'),
        item(locale, vi ? 'Đa thuê bao' : 'Multi-tenancy', '/guide/multi-tenancy'),
        item(locale, vi ? 'Các lớp cơ sở ORM' : 'ORM base classes', '/guide/orm-base-classes'),
        item(locale, vi ? 'Tích hợp audit' : 'Audit integration', '/guide/audit'),
      ],
    },
    {
      text: vi ? 'Xác thực & bảo mật' : 'Authentication & security',
      collapsed: true,
      items: [
        item(locale, vi ? 'Phân quyền' : 'Permissions', '/guide/permissions'),
        item(locale, 'JWT & Keycloak', '/guide/jwt-keycloak'),
        item(locale, vi ? 'Danh tính từ gateway tin cậy' : 'Trusted gateway identity', '/guide/trusted-gateway'),
        item(locale, vi ? 'Lời gọi nội bộ' : 'Internal calls', '/guide/internal-calls'),
      ],
    },
    {
      text: vi ? 'Dịch vụ' : 'Services',
      collapsed: true,
      items: [
        item(locale, vi ? 'Bộ nhớ đệm' : 'Caching', '/guide/cache'),
        item(locale, vi ? 'HTTP đi ra ngoài' : 'Outbound HTTP', '/guide/outbound-http'),
        item(locale, vi ? 'Kiểm tra dữ liệu' : 'Validation', '/guide/validation'),
        item(locale, vi ? 'Quốc tế hóa' : 'Internationalization', '/guide/i18n'),
      ],
    },
    {
      text: vi ? 'Mô-đun tính năng' : 'Feature modules',
      collapsed: true,
      items: [
        item(locale, vi ? 'Tổng quan tính năng' : 'Feature overview', '/guide/features'),
        item(locale, vi ? 'Tệp tải lên' : 'Uploaded files', '/guide/uploaded-files'),
        item(locale, vi ? 'Lịch sử thao tác' : 'Action history', '/guide/action-history'),
        item(locale, vi ? 'Bộ lập lịch tác vụ' : 'Job scheduler', '/guide/job-scheduler'),
        item(locale, vi ? 'Hàng đợi BullMQ' : 'BullMQ queue', '/guide/queue'),
      ],
    },
    {
      text: vi ? 'Ví dụ hoàn chỉnh' : 'Complete examples',
      collapsed: true,
      items: [
        item(locale, vi ? 'Tổng quan ví dụ' : 'Examples overview', '/examples/'),
        item(locale, vi ? 'Ứng dụng hoàn chỉnh' : 'Complete application', '/examples/complete-app'),
        item(locale, vi ? 'CRUD theo tenant' : 'Tenant-aware CRUD', '/examples/tenant-crud'),
        item(locale, vi ? 'Danh tính & phân quyền' : 'Identity & permissions', '/examples/identity-and-permissions'),
        item(locale, vi ? 'Cache & HTTP' : 'Cache & HTTP', '/examples/cache-and-http'),
        item(locale, vi ? 'Tệp tải lên' : 'Uploaded files', '/examples/uploaded-files'),
        item(locale, vi ? 'Lịch sử thao tác' : 'Action history', '/examples/action-history'),
        item(locale, vi ? 'Tác vụ theo lịch' : 'Scheduled jobs', '/examples/scheduled-jobs'),
        item(locale, vi ? 'Kiểm thử' : 'Testing', '/examples/testing'),
      ],
    },
    {
      text: vi ? 'Tham chiếu API' : 'API reference',
      collapsed: true,
      items: [
        item(locale, vi ? 'Tổng quan API' : 'API overview', '/api/'),
        item(locale, vi ? 'Mô-đun gốc' : 'Root module', '/api/root'),
        item(locale, vi ? 'Tổng quan core' : 'Core overview', '/api/core/'),
        item(locale, 'ORM', '/api/core/orm'),
        item(locale, vi ? 'Ngữ cảnh' : 'Context', '/api/core/context'),
        item(locale, vi ? 'Đa thuê bao' : 'Tenancy', '/api/core/tenancy'),
        item(locale, 'Audit', '/api/core/audit'),
        item(locale, vi ? 'Tổng quan auth' : 'Auth overview', '/api/auth/'),
        item(locale, 'JWT', '/api/auth/jwt'),
        item(locale, vi ? 'Phân quyền' : 'Permissions', '/api/auth/permissions'),
        item(locale, vi ? 'Tổng quan dịch vụ' : 'Services overview', '/api/services/'),
        item(locale, 'Cache', '/api/services/cache'),
        item(locale, 'HTTP', '/api/services/http'),
        item(locale, vi ? 'Kiểm tra dữ liệu' : 'Validation', '/api/validation'),
        item(locale, 'i18n', '/api/i18n'),
        item(locale, vi ? 'Hàng đợi' : 'Queue', '/api/queue'),
        item(locale, vi ? 'Tổng quan tính năng' : 'Features overview', '/api/features/'),
        item(locale, vi ? 'Tệp tải lên' : 'Uploaded files', '/api/features/uploaded-files'),
        item(locale, vi ? 'Lịch sử thao tác' : 'Action history', '/api/features/action-history'),
        item(locale, vi ? 'Bộ lập lịch tác vụ' : 'Job scheduler', '/api/features/job-scheduler'),
      ],
    },
    {
      text: vi ? 'Tài liệu tham khảo' : 'Reference',
      collapsed: true,
      items: [
        item(locale, vi ? 'Các entry point' : 'Entry points', '/reference/entry-points'),
        item(locale, vi ? 'REST endpoint' : 'REST endpoints', '/reference/rest-endpoints'),
        item(locale, vi ? 'Danh mục lỗi' : 'Error catalog', '/reference/errors'),
        item(locale, vi ? 'Lược đồ cơ sở dữ liệu' : 'Database schema', '/reference/database-schema'),
        item(locale, vi ? 'Checklist bảo mật' : 'Security checklist', '/reference/security'),
        item(locale, vi ? 'Tương thích' : 'Compatibility', '/reference/compatibility'),
        item(locale, vi ? 'Khắc phục sự cố' : 'Troubleshooting', '/reference/troubleshooting'),
      ],
    },
    {
      text: vi ? 'Bản phát hành & migration' : 'Releases & migrations',
      collapsed: true,
      items: [
        item(locale, vi ? 'Phiên bản 1.1.0' : 'Version 1.1.0', '/releases/1.1.0'),
        item(locale, vi ? 'Nâng cấp 1.0 → 1.1' : 'Upgrade 1.0 → 1.1', '/migrations/1.0-to-1.1'),
        item(locale, vi ? 'Chuyển từ core-be' : 'Migrate from core-be', '/migrations/from-core-be'),
        item(locale, vi ? 'Nhật ký thay đổi' : 'Changelog', '/releases/changelog'),
      ],
    },
  ];
}

/** @param {unknown[]} entries @returns {string[]} */
function collectLinks(entries) {
  return entries.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const value = /** @type {{ link?: unknown, items?: unknown[] }} */ (entry);
    return [typeof value.link === 'string' ? value.link : '', ...(Array.isArray(value.items) ? collectLinks(value.items) : [])].filter(
      Boolean,
    );
  });
}

/** Used by the documentation checker so generated navigation cannot silently point at a 404. */
export function navigationLinks() {
  return /** @type {const} */ ({
    en: collectLinks([...createNav('en'), ...createSidebar('en')]),
    vi: collectLinks([...createNav('vi'), ...createSidebar('vi')]),
  });
}
