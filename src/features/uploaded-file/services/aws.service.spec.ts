import 'reflect-metadata';
import { Readable } from 'node:stream';

jest.mock('@aws-sdk/client-s3', () => {
  const send = jest.fn();
  const S3Client = jest.fn().mockImplementation(() => ({ send }));
  const PutObjectCommand = jest.fn().mockImplementation((input: unknown) => ({ kind: 'PutObjectCommand', input }));
  const GetObjectCommand = jest.fn().mockImplementation((input: unknown) => ({ kind: 'GetObjectCommand', input }));
  const HeadObjectCommand = jest.fn().mockImplementation((input: unknown) => ({ kind: 'HeadObjectCommand', input }));
  const CopyObjectCommand = jest.fn().mockImplementation((input: unknown) => ({ kind: 'CopyObjectCommand', input }));
  const DeleteObjectsCommand = jest.fn().mockImplementation((input: unknown) => ({ kind: 'DeleteObjectsCommand', input }));

  return {
    S3Client,
    PutObjectCommand,
    GetObjectCommand,
    HeadObjectCommand,
    CopyObjectCommand,
    DeleteObjectsCommand,
    __mock: { send, S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, CopyObjectCommand, DeleteObjectsCommand },
  };
});

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn(
    async (_client: unknown, command: { kind: string }, options: { expiresIn: number }) =>
      `https://signed.test/${command.kind}?expires=${options.expiresIn}`,
  ),
}));

import { normalizeUploadedFileConfig } from '../config';
import { AwsUploadedFileStorage } from './aws.service';

interface S3SdkMock {
  send: jest.Mock;
  S3Client: jest.Mock;
  PutObjectCommand: jest.Mock;
  GetObjectCommand: jest.Mock;
  HeadObjectCommand: jest.Mock;
  CopyObjectCommand: jest.Mock;
  DeleteObjectsCommand: jest.Mock;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const sdk = (require('@aws-sdk/client-s3') as { __mock: S3SdkMock }).__mock;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const getSignedUrl = (require('@aws-sdk/s3-request-presigner') as { getSignedUrl: jest.Mock }).getSignedUrl;
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
    getSignedUrl.mockClear();
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

  it('creates a short-lived one-object PUT target with exact signed headers', async () => {
    const storage = new AwsUploadedFileStorage(config) as unknown as {
      createUploadUrl(input: Record<string, unknown>): Promise<{ method: string; url: string; headers: Record<string, string> }>;
    };

    await expect(
      storage.createUploadUrl({
        key: 'core/pending/tenant/file-id',
        contentType: 'image/png',
        size: 9,
        expiresInSeconds: 600,
        metadata: { 'upload-id': 'file-id', 'expected-size': '9' },
        checksum: 'c2hhMjU2',
      }),
    ).resolves.toEqual({
      method: 'PUT',
      url: 'https://signed.test/PutObjectCommand?expires=600',
      headers: {
        'content-length': '9',
        'content-type': 'image/png',
        'x-amz-checksum-sha256': 'c2hhMjU2',
        'x-amz-meta-expected-size': '9',
        'x-amz-meta-upload-id': 'file-id',
      },
    });
    expect(sdk.PutObjectCommand).toHaveBeenCalledWith({
      Bucket: 'bucket',
      Key: 'core/pending/tenant/file-id',
      ContentLength: 9,
      ContentType: 'image/png',
      ChecksumSHA256: 'c2hhMjU2',
      Metadata: { 'upload-id': 'file-id', 'expected-size': '9' },
    });
    expect(getSignedUrl).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: 'PutObjectCommand' }), { expiresIn: 600 });
  });

  it('heads and promotes the verified staging version without downloading it through the backend', async () => {
    const storage = new AwsUploadedFileStorage(config) as unknown as {
      headObject(key: string): Promise<Record<string, unknown> | null>;
      promoteObject(input: Record<string, unknown>): Promise<void>;
    };
    sdk.send.mockResolvedValueOnce({
      ContentLength: 9,
      ContentType: 'image/png',
      ETag: '"staging-etag"',
      Metadata: { 'upload-id': 'file-id' },
    });

    await expect(storage.headObject('core/pending/tenant/file-id')).resolves.toEqual({
      size: 9,
      contentType: 'image/png',
      etag: '"staging-etag"',
      checksum: null,
      metadata: { 'upload-id': 'file-id' },
    });
    await storage.promoteObject({
      sourceKey: 'core/pending/tenant/file-id',
      destinationKey: 'core/public/tenant/file-id/a.png',
      sourceEtag: '"staging-etag"',
      visibility: 'public',
      publicAccessMode: 'object-acl',
    });
    expect(sdk.CopyObjectCommand).toHaveBeenCalledWith({
      ACL: 'public-read',
      Bucket: 'bucket',
      CopySource: 'bucket/core/pending/tenant/file-id',
      CopySourceIfMatch: '"staging-etag"',
      Key: 'core/public/tenant/file-id/a.png',
    });
    expect(sdk.HeadObjectCommand).toHaveBeenCalledWith({
      Bucket: 'bucket',
      Key: 'core/pending/tenant/file-id',
      ChecksumMode: 'ENABLED',
    });
  });

  it('omits ACL in external public-access mode and signs private GET URLs', async () => {
    const storage = new AwsUploadedFileStorage(config) as unknown as {
      promoteObject(input: Record<string, unknown>): Promise<void>;
      createDownloadUrl(input: Record<string, unknown>): Promise<string>;
    };
    await storage.promoteObject({
      sourceKey: 'pending',
      destinationKey: 'public/final',
      sourceEtag: 'etag',
      visibility: 'public',
      publicAccessMode: 'external',
    });
    expect(sdk.CopyObjectCommand.mock.calls.at(-1)?.[0]).not.toHaveProperty('ACL');

    await expect(
      storage.createDownloadUrl({
        key: 'private/final',
        expiresInSeconds: 900,
        contentType: 'application/pdf',
        contentDisposition: 'inline',
      }),
    ).resolves.toBe('https://signed.test/GetObjectCommand?expires=900');
    expect(sdk.GetObjectCommand).toHaveBeenCalledWith({
      Bucket: 'bucket',
      Key: 'private/final',
      ResponseContentDisposition: 'inline',
      ResponseContentType: 'application/pdf',
    });
  });

  it('configures a custom S3-compatible origin endpoint independently from the public CDN', async () => {
    const spacesConfig = normalizeUploadedFileConfig({
      driver: 's3',
      bucket: 'assets',
      region: 'sgp1',
      endpoint: 'https://sgp1.digitaloceanspaces.com/',
      cdnBaseUrl: 'https://assets.example-cdn.test/',
    });
    const storage = new AwsUploadedFileStorage(spacesConfig) as unknown as { resolvePublicUrl(key: string): string };
    await (storage as unknown as { headObject(key: string): Promise<unknown> }).headObject('probe');

    expect(sdk.S3Client).toHaveBeenLastCalledWith({
      endpoint: 'https://sgp1.digitaloceanspaces.com',
      forcePathStyle: false,
      region: 'sgp1',
    });
    expect(storage.resolvePublicUrl('public/id/a.png')).toBe('https://assets.example-cdn.test/public/id/a.png');
  });

  it('derives encoded public origins for path-style, virtual-hosted, and AWS endpoints', () => {
    const pathStyle = new AwsUploadedFileStorage(
      normalizeUploadedFileConfig({
        driver: 's3',
        bucket: 'asset bucket',
        endpoint: 'https://objects.test:9443/',
        forcePathStyle: true,
      }),
    );
    expect(pathStyle.resolvePublicUrl('public/a file.png')).toBe('https://objects.test:9443/asset%20bucket/public/a%20file.png');

    const virtualHosted = new AwsUploadedFileStorage(
      normalizeUploadedFileConfig({ driver: 's3', bucket: 'assets', endpoint: 'https://objects.test:9443/' }),
    );
    expect(virtualHosted.resolvePublicUrl('public/a file.png')).toBe('https://assets.objects.test:9443/public/a%20file.png');

    const defaultRegion = new AwsUploadedFileStorage(normalizeUploadedFileConfig({ driver: 's3', bucket: 'assets' }));
    expect(defaultRegion.resolvePublicUrl('public/a file.png')).toBe('https://assets.s3.amazonaws.com/public/a%20file.png');

    const regional = new AwsUploadedFileStorage(normalizeUploadedFileConfig({ driver: 's3', bucket: 'assets', region: 'ap-southeast-1' }));
    expect(regional.resolvePublicUrl('public/a file.png')).toBe('https://assets.s3.ap-southeast-1.amazonaws.com/public/a%20file.png');
  });

  it('normalizes direct-control-plane failures and treats only exact not-found responses as absence', async () => {
    expect(
      () =>
        new AwsUploadedFileStorage({
          ...config,
          accessKey: undefined,
        }),
    ).toThrow(/credentials require both non-empty/);

    const storage = new AwsUploadedFileStorage(config);
    getSignedUrl.mockRejectedValueOnce(new Error('private signing detail'));
    await expect(
      storage.createUploadUrl({
        key: 'pending/key',
        contentType: 'text/plain',
        size: 1,
        expiresInSeconds: 60,
        metadata: {},
        checksum: null,
      }),
    ).rejects.toThrow(/^S3 upload URL creation failed$/);

    for (const error of [{ name: 'NotFound' }, { name: 'NoSuchKey' }, { Code: 'NoSuchKey' }, { $metadata: { httpStatusCode: 404 } }]) {
      sdk.send.mockRejectedValueOnce(error);
      await expect(storage.headObject('missing')).resolves.toBeNull();
    }
    sdk.send.mockRejectedValueOnce(new Error('private head detail'));
    await expect(storage.headObject('private')).rejects.toThrow(/^S3 object head failed$/);

    sdk.send.mockRejectedValueOnce(new Error('private copy detail'));
    await expect(
      storage.promoteObject({
        sourceKey: 'pending/key',
        destinationKey: 'private/key',
        sourceEtag: null,
        visibility: 'private',
        publicAccessMode: 'external',
      }),
    ).rejects.toThrow(/^S3 object promotion failed$/);

    getSignedUrl.mockRejectedValueOnce(new Error('private signing detail'));
    await expect(
      storage.createDownloadUrl({
        key: 'private/key',
        expiresInSeconds: 60,
        contentType: null,
        contentDisposition: null,
      }),
    ).rejects.toThrow(/^S3 download URL creation failed$/);

    await expect(storage.deleteObject('private/key')).resolves.toBeUndefined();
  });
});
