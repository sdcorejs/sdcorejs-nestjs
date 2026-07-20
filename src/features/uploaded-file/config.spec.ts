import type { Provider } from '@nestjs/common';
import { normalizeUploadedFileConfig } from './config';
import { AwsUploadedFileStorage } from './services/aws.service';
import { LocalUploadedFileStorage } from './services/local.service';
import { UPLOADED_FILE_STORAGE_DRIVER } from './storage-driver';
import { UploadedFileModule } from './uploaded-file.module';

function storageProvider(config: Parameters<typeof UploadedFileModule.forRoot>[0]): Provider {
  return UploadedFileModule.forRoot(config).providers?.find(
    (provider) =>
      typeof provider === 'object' && provider !== null && 'provide' in provider && provider.provide === UPLOADED_FILE_STORAGE_DRIVER,
  ) as Provider;
}

describe('uploaded-file configuration', () => {
  it('honors an explicit local driver even when dormant S3 credentials are present', () => {
    expect(storageProvider({ driver: 'local', accessId: 'id', accessKey: 'key', bucket: 'bucket' })).toMatchObject({
      useClass: LocalUploadedFileStorage,
    });
    expect(storageProvider({ accessId: 'id', accessKey: 'key', bucket: 'bucket' })).toMatchObject({ useClass: AwsUploadedFileStorage });
  });

  it('normalizes the resolved driver and trims the S3 tuple before provider selection', () => {
    expect(normalizeUploadedFileConfig({ accessId: ' id ', accessKey: ' key ', bucket: ' bucket ' })).toMatchObject({
      driver: 's3',
      accessId: 'id',
      accessKey: 'key',
      bucket: 'bucket',
    });
    expect(normalizeUploadedFileConfig({ driver: 'local', accessId: ' id ', accessKey: ' key ', bucket: ' bucket ' })).toMatchObject({
      driver: 'local',
      accessId: 'id',
      accessKey: 'key',
      bucket: 'bucket',
    });
  });

  it.each([
    { accessId: 'id' },
    { accessKey: 'key' },
    { accessId: '', accessKey: 'key' },
    { accessId: 'id', accessKey: '   ' },
    { driver: 'local' as const, accessId: 'id' },
    { driver: 'local' as const, accessId: ' ', accessKey: 'key', bucket: 'bucket' },
  ])('rejects partial or blank explicit S3 credentials at module registration: %j', (config) => {
    expect(() => UploadedFileModule.forRoot(config)).toThrow(/credentials require both non-empty accessId and accessKey/);
  });

  it.each([
    { driver: 's3' as const },
    { driver: 's3' as const, bucket: '' },
    { driver: 's3' as const, bucket: '   ' },
    { accessId: 'id', accessKey: 'key' },
    { accessId: 'id', accessKey: 'key', bucket: '   ' },
  ])('requires a non-blank bucket whenever S3 is selected: %j', (config) => {
    expect(() => UploadedFileModule.forRoot(config)).toThrow(/bucket must be a non-empty string/);
  });

  it('supports explicit S3 with the default AWS credential chain when a bucket is supplied', () => {
    expect(storageProvider({ driver: 's3', bucket: ' bucket ' })).toMatchObject({ useClass: AwsUploadedFileStorage });
  });

  it('normalizes non-finite remote limits to the bounded service upload limit', () => {
    const config = normalizeUploadedFileConfig({ maxFileSizeBytes: 1024, remoteClone: { enabled: true, maxBytes: Number.NaN } });
    expect(config.remoteClone.maxBytes).toBe(1024);
  });
});
