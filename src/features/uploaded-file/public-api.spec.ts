import * as uploadedFile from './index';
import { getMetadataArgsStorage } from 'typeorm';

describe('uploaded-file public API', () => {
  it('does NOT leak internal helpers', () => {
    const api = uploadedFile as Record<string, unknown>;
    for (const leaked of [
      'slugify',
      'isBlank',
      'toMb',
      'addDays',
      'distinct',
      'IUploadedFileStorage',
      'AwsUploadedFileStorage',
      'LocalUploadedFileStorage',
      'UPLOADED_FILE_STORAGE_DRIVER',
    ]) {
      expect(api[leaked]).toBeUndefined();
    }
  });

  it('exports the entity + module + service + controller', () => {
    const api = uploadedFile as Record<string, unknown>;
    expect(api.UploadedFile).toBeDefined();
    expect(api.UploadedFileModule).toBeDefined();
    expect(api.UploadedFileService).toBeDefined();
    expect(api.UploadedFileController).toBeDefined();
    expect(api.UploadedFileDirectLifecycle1785744000000).toBeDefined();
    expect((api.UploadedFileService as { prototype: Record<string, unknown> }).prototype.downloadAttached).toBeDefined();
    for (const method of [
      'upload',
      'uploadTemporary',
      'initiateUpload',
      'initiateTemporaryUpload',
      'completeUpload',
      'abortUpload',
      'findById',
      'find',
      'deleteById',
      'resolveUrl',
      'cleanupPendingUploads',
      'cleanupExpiredTemporaryFiles',
    ]) {
      expect((api.UploadedFileService as { prototype: Record<string, unknown> }).prototype[method]).toBeDefined();
    }
  });

  it('models direct-upload, visibility, and temporary-expiry lifecycle without removing legacy columns', () => {
    const api = uploadedFile as Record<string, unknown>;
    const entity = api.UploadedFile;
    const columns = getMetadataArgsStorage()
      .columns.filter(({ target }) => target === entity)
      .map(({ propertyName }) => propertyName);

    expect(columns).toEqual(
      expect.arrayContaining([
        'fileName',
        'fileSize',
        'key',
        'cdn',
        'contentType',
        'sizeBytes',
        'visibility',
        'status',
        'pendingKey',
        'isTemporary',
        'uploadExpiredAt',
        'expiredAt',
        'completedAt',
        'disposition',
        'checksum',
        'etag',
      ]),
    );
  });
});
