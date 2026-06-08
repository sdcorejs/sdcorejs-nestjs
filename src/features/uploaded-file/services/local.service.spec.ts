import 'reflect-metadata';

jest.mock('node:fs', () => ({
  existsSync: jest.fn(() => true),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn(),
  createReadStream: jest.fn(() => 'STREAM'),
  unlink: jest.fn((_p: string, cb: (e: null) => void) => cb(null)),
}));
jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn(async () => ({ data: Buffer.from('img') })) } }));

import { writeFileSync, createReadStream, unlink } from 'node:fs';
import axios from 'axios';
import { LocalUploadedFileStorage } from './local.service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeTracking(): any {
  return {
    getContent: jest.fn(() => ({})),
    create: jest.fn(async (args: Record<string, unknown>) => ({ id: 'f1', ...args })),
    markUsed: jest.fn(async () => undefined),
    useFiles: jest.fn(async () => undefined),
    delete: jest.fn(async () => undefined),
  };
}
const cfg = { folder: 'core', host: 'http://h/' };
const make = (t: ReturnType<typeof makeTracking>) => new LocalUploadedFileStorage(cfg as never, t);

describe('LocalUploadedFileStorage', () => {
  beforeEach(() => jest.clearAllMocks());

  it('upload writes the file and persists via tracking.create', async () => {
    const t = makeTracking();
    const res = await make(t).upload(Buffer.from('x'), 'logo.png', { module: 'masterdata', entity: 'brand' });
    expect(writeFileSync).toHaveBeenCalled();
    expect(t.create).toHaveBeenCalledWith(expect.objectContaining({ key: 'core/logo.png', module: 'masterdata' }));
    expect(res.key).toBe('core/logo.png');
  });

  it('upload defaults a missing fileName to TEMP', async () => {
    const t = makeTracking();
    await make(t).upload(Buffer.from('x'));
    expect(t.create).toHaveBeenCalledWith(expect.objectContaining({ fileName: 'TEMP' }));
  });

  it('upload throws BadRequest when the write fails', async () => {
    (writeFileSync as jest.Mock).mockImplementationOnce(() => {
      throw new Error('disk full');
    });
    await expect(make(makeTracking()).upload(Buffer.from('x'), 'a.png')).rejects.toMatchObject({ status: 400 });
  });

  it('uploadTemporary resolves a temp key (async — errors reject, not throw)', async () => {
    const out = await make(makeTracking()).uploadTemporary(Buffer.from('x'), 'a.png');
    expect(out.key).toContain('temporary/');
  });

  it('uploadTemporary rejects (does not synchronously throw) when the write fails', async () => {
    (writeFileSync as jest.Mock).mockImplementationOnce(() => {
      throw new Error('disk full');
    });
    // The call itself must not throw synchronously — it must return a rejecting promise.
    const p = make(makeTracking()).uploadTemporary(Buffer.from('x'), 'a.png');
    await expect(p).rejects.toMatchObject({ status: 400 });
  });

  it('download prefixes a bare key and streams it', () => {
    const out = make(makeTracking()).download('a.png');
    expect(createReadStream).toHaveBeenCalledWith(expect.stringContaining('/core/a.png'));
    expect(out).toBe('STREAM');
  });

  it('cloneFromUrl fetches the URL then uploads', async () => {
    const t = makeTracking();
    await make(t).cloneFromUrl('http://x/pic.png');
    expect(axios.get).toHaveBeenCalledWith('http://x/pic.png', expect.objectContaining({ responseType: 'arraybuffer' }));
    expect(t.create).toHaveBeenCalled();
  });

  it('useFiles normalizes keys then delegates to tracking', async () => {
    const t = makeTracking();
    await make(t).useFiles(['http://h/file-storage/core/a.png'], 'brand', 'b1');
    expect(t.useFiles).toHaveBeenCalledWith(['core/a.png'], 'brand', 'b1');
  });

  it('changeFiles unlinks removed files and soft-deletes the rows', async () => {
    const t = makeTracking();
    await make(t).changeFiles(['core/old.png'], ['core/new.png']);
    expect(t.useFiles).toHaveBeenCalledWith(['core/new.png'], undefined, undefined);
    expect(unlink).toHaveBeenCalled();
    expect(t.delete).toHaveBeenCalledWith(['core/old.png']);
  });

  it('markUsed delegates to tracking.markUsed', async () => {
    const t = makeTracking();
    await make(t).markUsed(['f1'], { entity: 'brand', entityId: 'b1' });
    expect(t.markUsed).toHaveBeenCalledWith(['f1'], { entity: 'brand', entityId: 'b1' });
  });
});
