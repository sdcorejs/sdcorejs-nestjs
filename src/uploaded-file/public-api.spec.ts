import * as uploadedFile from './index';

describe('uploaded-file public API', () => {
  it('does NOT leak internal generic helpers', () => {
    const api = uploadedFile as Record<string, unknown>;
    for (const leaked of ['slugify', 'isBlank', 'toMb', 'addDays', 'distinct']) {
      expect(api[leaked]).toBeUndefined();
    }
  });

  it('still exports the public service surface', () => {
    expect((uploadedFile as Record<string, unknown>).UploadedFileModule).toBeDefined();
  });
});
