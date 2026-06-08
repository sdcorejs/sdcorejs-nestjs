import * as uploadedFile from './index';

describe('uploaded-file public API', () => {
  it('does NOT leak internal helpers', () => {
    const api = uploadedFile as Record<string, unknown>;
    for (const leaked of ['slugify', 'isBlank', 'toMb', 'addDays', 'distinct']) {
      expect(api[leaked]).toBeUndefined();
    }
  });

  it('exports the entity + module + service + controller', () => {
    const api = uploadedFile as Record<string, unknown>;
    expect(api.UploadedFile).toBeDefined();
    expect(api.UploadedFileModule).toBeDefined();
    expect(api.UploadedFileService).toBeDefined();
    expect(api.UploadedFileController).toBeDefined();
  });
});
