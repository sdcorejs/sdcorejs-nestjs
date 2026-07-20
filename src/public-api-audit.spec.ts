import * as orm from './core/orm';
import * as context from './core/context';
import * as cache from './services/cache';
import * as validation from './validation';
import * as i18n from './i18n';

const undef = (m: Record<string, unknown>, names: string[]) => names.forEach((n) => expect(m[n]).toBeUndefined());

describe('1.0.0 public API — internal symbols are not leaked', () => {
  it('orm drops internal metadata keys + getHistoryRecorder', () => {
    undef(orm as Record<string, unknown>, [
      'SCOPED_METADATA',
      'SCOPED_COLUMNS',
      'SEARCHABLE_FIELDS_METADATA',
      'SCHEMA_METADATA',
      'SCHEMA_PROP_METADATA',
      'AUDIT_ENABLED_METADATA',
      'getHistoryRecorder',
    ]);
  });
  it('orm keeps public decorators + helpers', () => {
    const o = orm as Record<string, unknown>;
    ['Scoped', 'SearchableFields', 'Schema', 'SchemaProp', 'WithAudit', 'registerHistoryRecorder'].forEach((n) =>
      expect(o[n]).toBeDefined(),
    );
  });
  it('context drops DEFAULT_HEADERS_CONFIG', () => {
    undef(context as Record<string, unknown>, ['DEFAULT_HEADERS_CONFIG']);
    const c = context as Record<string, unknown>;
    expect(c.CONTEXT_IDENTITY_CONFIG).toBeDefined();
    expect(c.defaultVerifiedPrincipalResolver).toBeDefined();
  });
  it('cache keeps its scoped decorator surface public', () => {
    expect((cache as Record<string, unknown>).Cached).toBeDefined();
  });
  it('validation drops toIssues but keeps parseZod', () => {
    undef(validation as Record<string, unknown>, ['toIssues']);
    expect((validation as Record<string, unknown>).parseZod).toBeDefined();
  });
  it('i18n drops mergeCatalogs but keeps I18nModule', () => {
    undef(i18n as Record<string, unknown>, ['mergeCatalogs']);
    expect((i18n as Record<string, unknown>).I18nModule).toBeDefined();
  });
});
