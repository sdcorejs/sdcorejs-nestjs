import * as services from './index';
describe('services entry', () => {
  it('exposes the merged surface', () => {
    const s = services as Record<string, unknown>;
    for (const sym of ['HttpService', 'CacheService', 'CacheInterceptor']) {
      expect(s[sym]).toBeDefined();
    }
  });
});
