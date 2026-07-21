import * as core from './index';
describe('core entry', () => {
  it('exposes the merged surface (no silent export* hole)', () => {
    const c = core as Record<string, unknown>;
    for (const sym of [
      'BaseEntity',
      'ContextService',
      'CONTEXT_IDENTITY_CONFIG',
      'defaultVerifiedPrincipalResolver',
      'DefaultTenancyStrategy',
      'AuditSubscriber',
      'DefaultAuditStrategy',
    ]) {
      expect(c[sym]).toBeDefined();
    }
  });
});
