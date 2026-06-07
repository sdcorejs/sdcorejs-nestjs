import * as fileStorage from './index';

describe('file-storage public API', () => {
  it('does NOT leak internal generic helpers', () => {
    const api = fileStorage as Record<string, unknown>;
    for (const leaked of ['slugify', 'isBlank', 'toMb', 'addDays', 'distinct']) {
      expect(api[leaked]).toBeUndefined();
    }
  });

  it('still exports the public service surface', () => {
    expect((fileStorage as Record<string, unknown>).FileEntity).toBeDefined();
  });
});
