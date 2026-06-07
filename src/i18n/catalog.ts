import type { MessageCatalog } from './types';

/**
 * Built-in English messages for every `core.*` code `@sdcorejs/nestjs` throws. Consumers merge
 * their own catalog over this via `I18nModule.forRoot({ catalogs })`. Templates use `{var}`
 * placeholders matching the `data` thrown with each `apiError`.
 */
export const CORE_CATALOG_EN: MessageCatalog = {
  // validation
  'core.validation.failed': 'Validation failed',
  'core.validation.uuid': 'Invalid UUID',
  'core.validation.page-number.min': 'Page number must be 0 or greater',
  'core.validation.page-size.min': 'Page size must be at least 1',
  'core.validation.page-size.max': 'Page size must not exceed 1000',
  // permission
  'core.permission.forbidden': 'You do not have permission to perform this action',
  'core.permission.internal-secret-missing': 'Missing internal secret header',
  'core.permission.internal-secret-mismatch': 'Invalid internal secret',
  'core.permission.internal-secret-provider-missing': 'Internal secret provider is not configured',
  // repository
  'core.repository.invalid-uuid': 'Invalid UUID: {id}',
  'core.repository.invalid-field-name': 'Invalid field name: {field}',
  'core.repository.invalid-sort-field': 'Invalid sort field: {field}',
  'core.repository.column-not-found': 'Column not found: {field}',
  'core.repository.relation-not-found': 'Relation not found: {relation}',
  'core.repository.relation-not-found-in': 'Relation {relation} not found in {parent}',
  'core.repository.column-not-found-in': 'Column {column} not found in {parent}',
};

/** Built-in Vietnamese messages for every `core.*` code. */
export const CORE_CATALOG_VI: MessageCatalog = {
  // validation
  'core.validation.failed': 'Dữ liệu không hợp lệ',
  'core.validation.uuid': 'UUID không hợp lệ',
  'core.validation.page-number.min': 'Số trang phải lớn hơn hoặc bằng 0',
  'core.validation.page-size.min': 'Kích thước trang tối thiểu là 1',
  'core.validation.page-size.max': 'Kích thước trang tối đa là 1000',
  // permission
  'core.permission.forbidden': 'Bạn không có quyền thực hiện hành động này',
  'core.permission.internal-secret-missing': 'Thiếu header internal secret',
  'core.permission.internal-secret-mismatch': 'Internal secret không hợp lệ',
  'core.permission.internal-secret-provider-missing': 'Chưa cấu hình internal secret provider',
  // repository
  'core.repository.invalid-uuid': 'UUID không hợp lệ: {id}',
  'core.repository.invalid-field-name': 'Tên trường không hợp lệ: {field}',
  'core.repository.invalid-sort-field': 'Trường sắp xếp không hợp lệ: {field}',
  'core.repository.column-not-found': 'Không tìm thấy cột: {field}',
  'core.repository.relation-not-found': 'Không tìm thấy quan hệ: {relation}',
  'core.repository.relation-not-found-in': 'Không tìm thấy quan hệ {relation} trong {parent}',
  'core.repository.column-not-found-in': 'Không tìm thấy cột {column} trong {parent}',
};

/** Built-in catalogs keyed by language code. */
export const CORE_CATALOGS = { en: CORE_CATALOG_EN, vi: CORE_CATALOG_VI };
