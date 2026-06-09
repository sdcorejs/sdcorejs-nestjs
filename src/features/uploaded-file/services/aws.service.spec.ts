import 'reflect-metadata';

jest.mock('aws-sdk', () => {
  const s3 = {
    upload: jest.fn((_p: unknown, cb: (e: Error | null) => void) => cb(null)),
    getObject: jest.fn(() => ({ createReadStream: () => 'STREAM' })),
    deleteObjects: jest.fn((_p: unknown, cb: (e: Error | null, d: unknown) => void) => cb(null, {})),
  };
  return { S3: jest.fn(() => s3), __s3: s3 };
});

import { AwsUploadedFileStorage } from './aws.service';
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
const s3 = (require('aws-sdk') as any).__s3;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeTracking(): any {
  return {
    getContent: jest.fn(() => ({ ContentType: 'image/png', ContentDisposition: 'inline' })),
    create: jest.fn(async (args: Record<string, unknown>) => ({ id: 'f1', ...args })),
    delete: jest.fn(async () => undefined),
    useFiles: jest.fn(async () => undefined),
    markUsed: jest.fn(async () => undefined),
  };
}

const cfg = { driver: 's3', bucket: 'b', accessId: 'a', accessKey: 'k', folder: 'core', cdnBaseUrl: 'https://cdn/' };
const make = (t: ReturnType<typeof makeTracking>) => new AwsUploadedFileStorage(cfg as never, t);

describe('AwsUploadedFileStorage', () => {
  beforeEach(() => jest.clearAllMocks());

  it('upload puts to S3 and persists the tracking row', async () => {
    const t = makeTracking();
    const res = await make(t).upload(Buffer.from('x'), 'logo.png', { module: 'm', entity: 'brand' });
    expect(s3.upload).toHaveBeenCalled();
    expect(t.create).toHaveBeenCalledWith(expect.objectContaining({ fileName: 'logo.png', module: 'm', entity: 'brand' }));
    expect(res.id).toBe('f1');
    expect(res.cdn).toContain('https://cdn/');
  });

  it('upload defaults a missing fileName to TEMP (never persists undefined into the not-null column)', async () => {
    const t = makeTracking();
    await make(t).upload(Buffer.from('x'));
    expect(t.create).toHaveBeenCalledWith(expect.objectContaining({ fileName: 'TEMP' }));
  });

  it('upload rejects with BadRequest when S3 fails', async () => {
    s3.upload.mockImplementationOnce((_p: unknown, cb: (e: Error | null) => void) => cb(new Error('s3 down')));
    await expect(make(makeTracking()).upload(Buffer.from('x'), 'a.png')).rejects.toMatchObject({ status: 400 });
  });

  it('download streams by key (already-prefixed key is used as-is)', () => {
    const out = make(makeTracking()).download('core/a.png');
    expect(s3.getObject).toHaveBeenCalledWith(expect.objectContaining({ Key: 'core/a.png' }));
    expect(out).toBe('STREAM');
  });

  it('download prefixes a bare key with the folder', () => {
    make(makeTracking()).download('a.png');
    expect(s3.getObject).toHaveBeenCalledWith(expect.objectContaining({ Key: 'core/a.png' }));
  });

  it('changeFiles deletes removed folder keys and soft-deletes the rows', async () => {
    const t = makeTracking();
    await make(t).changeFiles(['core/old.png'], []);
    expect(s3.deleteObjects).toHaveBeenCalled();
    expect(t.delete).toHaveBeenCalledWith(['core/old.png']);
  });

  it('changeFiles ignores keys outside the folder (normalizeKeys filter)', async () => {
    const t = makeTracking();
    await make(t).changeFiles(['somewhere/x.png'], []);
    expect(s3.deleteObjects).not.toHaveBeenCalled();
    expect(t.delete).not.toHaveBeenCalled();
  });
});
