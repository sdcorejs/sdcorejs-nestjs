import 'reflect-metadata';
import type { ModuleRef } from '@nestjs/core';
import type { ContextService } from '../../../core/context/context.service';
import { UploadedFileService } from './uploaded-file.service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeRepoMock(row: any = null): any {
  const execute = jest.fn(async () => ({ affected: 1 }));
  const qb = { update: jest.fn(() => qb), where: jest.fn(() => qb), execute };
  return {
    create: jest.fn((e: unknown) => e),
    save: jest.fn(async (e: any) => ({ ...e, id: 'f1' })),
    findOne: jest.fn(async () => row),
    update: jest.fn(async () => ({ affected: 1 })),
    createQueryBuilder: jest.fn(() => qb),
    __qb: qb,
  };
}

const ctx = (userId?: string): ContextService => ({ userId, getCustom: () => undefined, tenant: undefined }) as unknown as ContextService;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const moduleRefWith = (storage: any): ModuleRef => ({ get: jest.fn(() => storage) }) as unknown as ModuleRef;
const noModuleRef = (): ModuleRef => ({ get: jest.fn() }) as unknown as ModuleRef;

describe('UploadedFileService', () => {
  describe('create', () => {
    it('persists the row (with meta + extraData) and returns it including the generated id', async () => {
      const repo = makeRepoMock();
      const svc = new UploadedFileService(repo, noModuleRef(), ctx('u1'));
      const row = await svc.create<{ origin: string }>({
        fileName: 'logo.png',
        fileSize: 1.2,
        key: 'core/logo.png',
        cdn: 'https://cdn/core/logo.png',
        module: 'masterdata',
        entity: 'brand',
        entityId: 'b1',
        type: 'logo',
        extraData: { origin: 'import' },
      });
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          module: 'masterdata',
          entity: 'brand',
          entityId: 'b1',
          type: 'logo',
          fileExtension: 'png',
          userId: 'u1',
          extraData: { origin: 'import' },
        }),
      );
      expect(repo.save).toHaveBeenCalled();
      expect(row.id).toBe('f1');
    });
  });

  describe('upload', () => {
    it('delegates to the storage driver, stamps extraData, and returns the persisted row', async () => {
      const stored = { id: 'f9', fileName: 'a.png', fileSize: 1, key: 'core/a.png', cdn: 'https://cdn/core/a.png' };
      const storage = { upload: jest.fn(async () => stored), download: jest.fn() };
      const repo = makeRepoMock({ id: 'f9', key: 'core/a.png', fileName: 'a.png' });
      const svc = new UploadedFileService(repo, moduleRefWith(storage), ctx('u1'));
      const out = await svc.upload<{ origin: string }>(Buffer.from('x'), 'a.png', { module: 'm' }, { origin: 'web' });
      expect(storage.upload).toHaveBeenCalledWith(expect.any(Buffer), 'a.png', { module: 'm' });
      expect(repo.update).toHaveBeenCalledWith({ id: 'f9' }, { extraData: { origin: 'web' } });
      expect(out.id).toBe('f9');
    });

    it('skips the extraData update when none is provided', async () => {
      const storage = { upload: jest.fn(async () => ({ id: 'f1', fileName: 'a', fileSize: 1, key: 'k', cdn: 'c' })), download: jest.fn() };
      const repo = makeRepoMock({ id: 'f1', key: 'k', fileName: 'a' });
      const svc = new UploadedFileService(repo, moduleRefWith(storage), ctx());
      await svc.upload(Buffer.from('x'), 'a');
      expect(repo.update).not.toHaveBeenCalled();
    });
  });

  describe('download', () => {
    it('resolves the row by id then streams by key', async () => {
      const storage = { upload: jest.fn(), download: jest.fn(() => 'STREAM') };
      const repo = makeRepoMock({ id: 'f1', key: 'core/a.png', fileName: 'a.png' });
      const svc = new UploadedFileService(repo, moduleRefWith(storage), ctx());
      const res = await svc.download('f1');
      expect(storage.download).toHaveBeenCalledWith('core/a.png');
      expect(res).toEqual({ stream: 'STREAM', fileName: 'a.png' });
    });

    it('throws when the id is unknown', async () => {
      const storage = { upload: jest.fn(), download: jest.fn() };
      const repo = makeRepoMock(null);
      const svc = new UploadedFileService(repo, moduleRefWith(storage), ctx());
      await expect(svc.download('nope')).rejects.toBeTruthy();
      expect(storage.download).not.toHaveBeenCalled();
    });
  });

  describe('setExtraData', () => {
    it('replaces the extraData bag for the row', async () => {
      const repo = makeRepoMock();
      const svc = new UploadedFileService(repo, noModuleRef(), ctx());
      await svc.setExtraData<{ a: number }>('f1', { a: 1 });
      expect(repo.update).toHaveBeenCalledWith({ id: 'f1' }, { extraData: { a: 1 } });
    });
  });

  describe('markUsed', () => {
    it('flips isUsed by id and stamps provided meta (skips undefined keys)', async () => {
      const repo = makeRepoMock();
      const svc = new UploadedFileService(repo, noModuleRef(), ctx('u1'));
      await svc.markUsed(['f1', 'f2'], { entity: 'brand', entityId: 'b1' });
      expect(repo.__qb.update).toHaveBeenCalledWith(expect.objectContaining({ isUsed: true, entity: 'brand', entityId: 'b1' }));
      const arg = repo.__qb.update.mock.calls[0][0];
      expect('module' in arg).toBe(false);
      expect(repo.__qb.execute).toHaveBeenCalled();
    });
    it('no-ops on empty ids', async () => {
      const repo = makeRepoMock();
      const svc = new UploadedFileService(repo, noModuleRef(), ctx('u1'));
      await svc.markUsed([]);
      expect(repo.createQueryBuilder).not.toHaveBeenCalled();
    });
  });
});
