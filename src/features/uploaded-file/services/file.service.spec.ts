import 'reflect-metadata';
import type { ContextService } from '../../../context/context.service';
import { UploadedFileService } from './uploaded-file.service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeRepoMock(): any {
  const execute = jest.fn(async () => ({ affected: 1 }));
  const qb = { update: jest.fn(() => qb), where: jest.fn(() => qb), execute };
  return {
    create: jest.fn((e: unknown) => e),
    save: jest.fn(async (e: any) => ({ ...e, id: 'f1' })),
    createQueryBuilder: jest.fn(() => qb),
    __qb: qb,
  };
}

const ctx = (userId?: string): ContextService => ({ userId, getCustom: () => undefined, tenant: undefined }) as unknown as ContextService;

describe('UploadedFileService', () => {
  describe('create', () => {
    it('persists the row (with meta) and returns it including the generated id', async () => {
      const repo = makeRepoMock();
      const svc = new UploadedFileService(repo, ctx('u1'));
      const row = await svc.create({
        fileName: 'logo.png',
        fileSize: 1.2,
        key: 'core/logo.png',
        cdn: 'https://cdn/core/logo.png',
        module: 'masterdata',
        entity: 'brand',
        entityId: 'b1',
        type: 'logo',
      });
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          module: 'masterdata',
          entity: 'brand',
          entityId: 'b1',
          type: 'logo',
          fileExtension: 'png',
          userId: 'u1',
        }),
      );
      expect(repo.save).toHaveBeenCalled();
      expect(row.id).toBe('f1');
    });
  });

  describe('markUsed', () => {
    it('flips isUsed by id and stamps provided meta (skips undefined keys)', async () => {
      const repo = makeRepoMock();
      const svc = new UploadedFileService(repo, ctx('u1'));
      await svc.markUsed(['f1', 'f2'], { entity: 'brand', entityId: 'b1' });
      expect(repo.__qb.update).toHaveBeenCalledWith(expect.objectContaining({ isUsed: true, entity: 'brand', entityId: 'b1' }));
      const arg = repo.__qb.update.mock.calls[0][0];
      expect('module' in arg).toBe(false);
      expect(repo.__qb.execute).toHaveBeenCalled();
    });
    it('no-ops on empty ids', async () => {
      const repo = makeRepoMock();
      const svc = new UploadedFileService(repo, ctx('u1'));
      await svc.markUsed([]);
      expect(repo.createQueryBuilder).not.toHaveBeenCalled();
    });
  });
});
