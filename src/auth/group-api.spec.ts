import * as auth from './index';
describe('auth entry', () => {
  it('exposes the merged surface', () => {
    const a = auth as Record<string, unknown>;
    for (const sym of ['AuthGuard', 'JwtModule', 'InternalGuard']) {
      expect(a[sym]).toBeDefined();
    }
  });
});
