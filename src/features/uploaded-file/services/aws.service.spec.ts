import 'reflect-metadata';
import { Readable } from 'node:stream';

jest.mock('@aws-sdk/client-s3', () => {
  const send = jest.fn();
  const S3Client = jest.fn().mockImplementation(() => ({ send }));
  const PutObjectCommand = jest.fn().mockImplementation((input: unknown) => ({ kind: 'PutObjectCommand', input }));
  const GetObjectCommand = jest.fn().mockImplementation((input: unknown) => ({ kind: 'GetObjectCommand', input }));
  const DeleteObjectsCommand = jest.fn().mockImplementation((input: unknown) => ({ kind: 'DeleteObjectsCommand', input }));

  return {
    S3Client,
    PutObjectCommand,
    GetObjectCommand,
    DeleteObjectsCommand,
    __mock: { send, S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectsCommand },
  };
});

import { normalizeUploadedFileConfig } from '../config';
import { AwsUploadedFileStorage } from './aws.service';

interface S3SdkMock {
  send: jest.Mock;
  S3Client: jest.Mock;
  PutObjectCommand: jest.Mock;
  GetObjectCommand: jest.Mock;
  DeleteObjectsCommand: jest.Mock;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const sdk = (require('@aws-sdk/client-s3') as { __mock: S3SdkMock }).__mock;
const config = normalizeUploadedFileConfig({
  driver: 's3',
  bucket: 'bucket',
  accessId: 'access',
  accessKey: 'secret',
  region: 'ap-southeast-1',
  cdnBaseUrl: 'https://cdn.test/',
});
const options = { contentType: 'image/png', contentDisposition: 'attachment' };

describe('AwsUploadedFileStorage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sdk.send.mockReset();
    sdk.send.mockResolvedValue({});
  });

  it('lazy-loads the v3 client and maps only explicitly configured credentials', async () => {
    const storage = new AwsUploadedFileStorage(config);
    expect(sdk.S3Client).not.toHaveBeenCalled();

    await storage.write('core/tenant/t/id/a.png', Buffer.from('png'), options);

    expect(sdk.S3Client).toHaveBeenCalledWith({
      credentials: { accessKeyId: 'access', secretAccessKey: 'secret' },
      region: 'ap-southeast-1',
    });

    const defaultChainStorage = new AwsUploadedFileStorage(
      normalizeUploadedFileConfig({ driver: 's3', bucket: 'bucket', region: 'ap-southeast-1' }),
    );
    await defaultChainStorage.write('core/tenant/t/id/b.png', Buffer.from('png'), options);
    expect(sdk.S3Client).toHaveBeenLastCalledWith({ region: 'ap-southeast-1' });
  });

  it('writes the exact server-generated key with a conditional PutObject command', async () => {
    const storage = new AwsUploadedFileStorage(config);
    const key = 'core/tenant/dGVuYW50/00000000-0000-4000-8000-000000000001/a.png';

    await storage.write(key, Buffer.from('png'), options);

    expect(sdk.PutObjectCommand).toHaveBeenCalledWith({
      Bucket: 'bucket',
      Key: key,
      Body: expect.any(Buffer),
      ContentType: 'image/png',
      ContentDisposition: 'attachment',
      IfNoneMatch: '*',
    });
    expect(sdk.send).toHaveBeenCalledWith(expect.objectContaining({ kind: 'PutObjectCommand' }));
  });

  it('downloads only the exact key and returns a Node Readable', async () => {
    const storage = new AwsUploadedFileStorage(config);
    const key = 'core/tenant/t/id/a.png';
    const stream = Readable.from(Buffer.from('payload'));
    sdk.send.mockResolvedValueOnce({ Body: stream });

    await expect(storage.download(key)).resolves.toBe(stream);

    expect(sdk.GetObjectCommand).toHaveBeenCalledWith({ Bucket: 'bucket', Key: key });
    expect(sdk.send).toHaveBeenCalledWith(expect.objectContaining({ kind: 'GetObjectCommand' }));
  });

  it('deletes distinct exact keys without filename/CDN normalization', async () => {
    const storage = new AwsUploadedFileStorage(config);
    await storage.delete(['core/tenant/t/one/a.png', 'core/tenant/t/two/a.png', 'core/tenant/t/one/a.png']);

    expect(sdk.DeleteObjectsCommand).toHaveBeenCalledWith({
      Bucket: 'bucket',
      Delete: { Objects: [{ Key: 'core/tenant/t/one/a.png' }, { Key: 'core/tenant/t/two/a.png' }] },
    });
  });

  it('chunks S3 deletion requests at the 1000-object API limit', async () => {
    const storage = new AwsUploadedFileStorage(config);
    const keys = Array.from({ length: 1001 }, (_, index) => `core/tenant/t/${index}/a.png`);

    await storage.delete(keys);

    expect(sdk.DeleteObjectsCommand).toHaveBeenCalledTimes(2);
    expect(sdk.DeleteObjectsCommand.mock.calls[0][0].Delete.Objects).toHaveLength(1000);
    expect(sdk.DeleteObjectsCommand.mock.calls[1][0].Delete.Objects).toEqual([{ Key: keys[1000] }]);
  });

  it('checks per-object deletion errors in every S3 chunk', async () => {
    const storage = new AwsUploadedFileStorage(config);
    const keys = Array.from({ length: 1001 }, (_, index) => `core/tenant/t/${index}/a.png`);
    sdk.send.mockResolvedValueOnce({}).mockResolvedValueOnce({ Errors: [{ Key: keys[1000], Code: 'AccessDenied' }] });

    await expect(storage.delete(keys)).rejects.toThrow(/^S3 object deletion failed$/);
    expect(sdk.DeleteObjectsCommand).toHaveBeenCalledTimes(2);
  });

  it('uses generic storage errors and does not expose SDK details', async () => {
    const storage = new AwsUploadedFileStorage(config);
    sdk.send.mockRejectedValueOnce(new Error('bucket/path/private detail'));
    await expect(storage.write('core/tenant/t/id/a.png', Buffer.from('x'), options)).rejects.toThrow(/^S3 object write failed$/);

    sdk.send.mockRejectedValueOnce(new Error('private key detail'));
    await expect(storage.download('core/tenant/t/id/a.png')).rejects.toThrow(/^S3 object download failed$/);

    sdk.send.mockResolvedValueOnce({ Body: 'web-stream-or-blob' });
    await expect(storage.download('core/tenant/t/id/a.png')).rejects.toThrow(/^S3 object download failed$/);

    sdk.send.mockRejectedValueOnce(new Error('private delete detail'));
    await expect(storage.delete(['core/tenant/t/id/a.png'])).rejects.toThrow(/^S3 object deletion failed$/);
  });

  it('does not mislabel SDK initialization failures as a missing optional dependency', async () => {
    sdk.S3Client.mockImplementationOnce(() => {
      throw new Error('private module initialization detail');
    });

    await expect(new AwsUploadedFileStorage(config).write('core/tenant/t/id/a.png', Buffer.from('x'), options)).rejects.toThrow(
      /^S3 object write failed$/,
    );
  });

  it('classifies only direct S3 package resolution failures as a missing optional dependency', () => {
    const storage = new AwsUploadedFileStorage(config) as unknown as {
      isMissingS3Package(error: unknown): boolean;
    };
    const missingPackage = Object.assign(new Error("Cannot find package '@aws-sdk/client-s3' imported from aws.service.js"), {
      code: 'ERR_MODULE_NOT_FOUND',
    });
    const missingTransitive = Object.assign(
      new Error("Cannot find module '@smithy/missing'\nRequire stack:\n- node_modules/@aws-sdk/client-s3/index.js"),
      { code: 'MODULE_NOT_FOUND' },
    );

    expect(storage.isMissingS3Package(missingPackage)).toBe(true);
    expect(storage.isMissingS3Package(missingTransitive)).toBe(false);
    expect(storage.isMissingS3Package(new Error('private module initialization detail'))).toBe(false);
  });

  it('rejects partial explicit credentials during central configuration normalization', () => {
    expect(() => normalizeUploadedFileConfig({ driver: 's3', bucket: 'bucket', accessId: 'access' })).toThrow(
      /^UploadedFileConfig S3 credentials require both non-empty accessId and accessKey$/,
    );
    expect(sdk.S3Client).not.toHaveBeenCalled();
  });

  it('builds the optional public URL from the exact object key', () => {
    expect(new AwsUploadedFileStorage(config).publicUrl('core/tenant/t/id/a.png')).toBe('https://cdn.test/core/tenant/t/id/a.png');
  });
});
