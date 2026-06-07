import * as uploadedFile from './index';

describe('uploaded-file public API', () => {
  it('does NOT leak internal helpers', () => {
    const api = uploadedFile as Record<string, unknown>;
    for (const leaked of ['slugify', 'isBlank', 'toMb', 'addDays', 'distinct']) {
      expect(api[leaked]).toBeUndefined();
    }
  });

  it('does NOT export the entity (canonical at @sdcorejs/nestjs/entities)', () => {
    expect((uploadedFile as Record<string, unknown>).UploadedFile).toBeUndefined();
  });

  it('exports the module + service', () => {
    const api = uploadedFile as Record<string, unknown>;
    expect(api.UploadedFileModule).toBeDefined();
    expect(api.UploadedFileService).toBeDefined();
  });
});
