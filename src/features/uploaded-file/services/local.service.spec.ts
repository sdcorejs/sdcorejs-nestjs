import 'reflect-metadata';

jest.mock('node:fs', () => ({
  existsSync: jest.fn(() => true),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn(),
  createReadStream: jest.fn(),
  unlink: jest.fn((_p: string, cb: (e: null) => void) => cb(null)),
}));

import { LocalUploadedFileStorage } from './local.service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeTracking(): any {
  return {
    getContent: jest.fn(() => ({})),
    create: jest.fn(async (args: any) => ({ id: 'f1', ...args })),
    markUsed: jest.fn(async () => undefined),
    useFiles: jest.fn(async () => undefined),
    delete: jest.fn(async () => undefined),
  };
}

describe('LocalUploadedFileStorage.upload', () => {
  it('persists via tracking.create with meta and returns the row id', async () => {
    const tracking = makeTracking();
    const svc = new LocalUploadedFileStorage({ folder: 'core', host: 'http://h/' } as any, tracking);
    const res = await svc.upload(Buffer.from('x'), 'logo.png', { module: 'masterdata', entity: 'brand', type: 'logo' });
    expect(tracking.create).toHaveBeenCalledWith(
      expect.objectContaining({ module: 'masterdata', entity: 'brand', type: 'logo', key: 'core/logo.png' }),
    );
    expect(res.id).toBe('f1');
    expect(res.key).toBe('core/logo.png');
  });
  it('markUsed delegates to tracking.markUsed', async () => {
    const tracking = makeTracking();
    const svc = new LocalUploadedFileStorage({ folder: 'core', host: 'http://h/' } as any, tracking);
    await svc.markUsed(['f1'], { entity: 'brand', entityId: 'b1' });
    expect(tracking.markUsed).toHaveBeenCalledWith(['f1'], { entity: 'brand', entityId: 'b1' });
  });
});
