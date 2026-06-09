import 'reflect-metadata';
import type { ModuleRef } from '@nestjs/core';
import type { ContextService } from '../../../core/context/context.service';
import { UploadedFileService } from './uploaded-file.service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeRepoMock(row: any = null, rowsForDelete: any[] = []): any {
  const execute = jest.fn(async () => ({ affected: 1 }));
  const getMany = jest.fn(async () => rowsForDelete);
  const qb = { update: jest.fn(() => qb), where: jest.fn(() => qb), getMany, execute };
  return {
    create: jest.fn((e: unknown) => e),
    save: jest.fn(async (e: any) => ({ ...e, id: 'f1' })),
    findOne: jest.fn(async () => row),
    update: jest.fn(async () => ({ affected: 1 })),
    softDelete: jest.fn(async () => ({ affected: rowsForDelete.length })),
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
        expect.objectContaining({ module: 'masterdata', fileExtension: 'png', userId: 'u1', extraData: { origin: 'import' } }),
      );
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

    it('throws when the persisted row cannot be re-read after upload', async () => {
      const storage = {
        upload: jest.fn(async () => ({ id: 'gone', fileName: 'a', fileSize: 1, key: 'k', cdn: 'c' })),
        download: jest.fn(),
      };
      const repo = makeRepoMock(null); // findOne → null
      const svc = new UploadedFileService(repo, moduleRefWith(storage), ctx());
      await expect(svc.upload(Buffer.from('x'), 'a')).rejects.toMatchObject({ status: 400 });
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
      const svc = new UploadedFileService(makeRepoMock(null), moduleRefWith(storage), ctx());
      await expect(svc.download('nope')).rejects.toBeTruthy();
      expect(storage.download).not.toHaveBeenCalled();
    });
  });

  describe('findById', () => {
    it('returns the row from the repository', async () => {
      const repo = makeRepoMock({ id: 'f1', key: 'k', fileName: 'a' });
      const svc = new UploadedFileService(repo, noModuleRef(), ctx());
      expect(await svc.findById('f1')).toMatchObject({ id: 'f1' });
      expect(repo.findOne).toHaveBeenCalledWith({ where: { id: 'f1' } });
    });
  });

  describe('getContent', () => {
    it('maps a known extension to an inline content type', () => {
      const svc = new UploadedFileService(makeRepoMock(), noModuleRef(), ctx());
      expect(svc.getContent('a.png')).toEqual({ ContentType: 'image/png', ContentDisposition: 'inline' });
    });
    it('returns an empty object for an unknown extension or no name', () => {
      const svc = new UploadedFileService(makeRepoMock(), noModuleRef(), ctx());
      expect(svc.getContent('a.xyz')).toEqual({});
      expect(svc.getContent(undefined)).toEqual({});
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

  describe('useFiles', () => {
    it('does NOT include entity/entityId in the SET when they are omitted (no NULL-overwrite)', async () => {
      const repo = makeRepoMock();
      const svc = new UploadedFileService(repo, noModuleRef(), ctx());
      await svc.useFiles(['k1', 'k2']);
      const setArg = repo.__qb.update.mock.calls[0][0];
      expect(setArg).toEqual({ isUsed: true });
      expect('entity' in setArg).toBe(false);
      expect('entityId' in setArg).toBe(false);
    });

    it('includes entity/entityId in the SET when provided', async () => {
      const repo = makeRepoMock();
      const svc = new UploadedFileService(repo, noModuleRef(), ctx());
      await svc.useFiles(['k1'], 'brand', 'b1');
      expect(repo.__qb.update).toHaveBeenCalledWith({ isUsed: true, entity: 'brand', entityId: 'b1' });
    });

    it('no-ops on empty keys', async () => {
      const repo = makeRepoMock();
      const svc = new UploadedFileService(repo, noModuleRef(), ctx());
      await svc.useFiles([]);
      expect(repo.createQueryBuilder).not.toHaveBeenCalled();
    });
  });

  describe('markUsed', () => {
    it('flips isUsed by id and stamps provided meta (skips undefined keys)', async () => {
      const repo = makeRepoMock();
      const svc = new UploadedFileService(repo, noModuleRef(), ctx('u1'));
      await svc.markUsed(['f1', 'f2'], { entity: 'brand', entityId: 'b1' });
      expect(repo.__qb.update).toHaveBeenCalledWith(expect.objectContaining({ isUsed: true, entity: 'brand', entityId: 'b1' }));
      expect('module' in repo.__qb.update.mock.calls[0][0]).toBe(false);
    });
    it('no-ops on empty ids', async () => {
      const repo = makeRepoMock();
      const svc = new UploadedFileService(repo, noModuleRef(), ctx('u1'));
      await svc.markUsed([]);
      expect(repo.createQueryBuilder).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('soft-deletes the rows matched by key', async () => {
      const repo = makeRepoMock(null, [{ id: 'f1' }, { id: 'f2' }]);
      const svc = new UploadedFileService(repo, noModuleRef(), ctx());
      await svc.delete(['core/a.png', 'core/b.png']);
      expect(repo.softDelete).toHaveBeenCalledWith(['f1', 'f2']);
    });
    it('no-ops on empty keys', async () => {
      const repo = makeRepoMock();
      const svc = new UploadedFileService(repo, noModuleRef(), ctx());
      await svc.delete([]);
      expect(repo.createQueryBuilder).not.toHaveBeenCalled();
    });
  });
});
