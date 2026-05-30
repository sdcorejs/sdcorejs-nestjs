import 'reflect-metadata';
import type { ContextService } from '../context/context.service';
import type { HistoryEntry } from '../orm/history';
import { ActionHistoryService } from './action-history.service';
import { ActionHistoryType } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeRepoMock(rows: any[] = []): any {
  return {
    create: jest.fn((e: unknown) => e),
    save: jest.fn(async (e: unknown) => e),
    find: jest.fn(async () => rows),
  };
}

const ctx = (userId?: string): ContextService => ({ userId }) as ContextService;

describe('ActionHistoryService', () => {
  describe('create', () => {
    it('persists the entry with the default actor (ctx.userId)', async () => {
      const repo = makeRepoMock();
      const svc = new ActionHistoryService(repo, ctx('u1'));
      await svc.create({ table: 't', tableId: 'r1', type: ActionHistoryType.CREATE, toData: { a: 1 } });
      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ table: 't', tableId: 'r1', userId: 'u1' }));
      expect(repo.save).toHaveBeenCalled();
    });

    it('uses a custom actor resolver when provided', async () => {
      const repo = makeRepoMock();
      const svc = new ActionHistoryService(repo, ctx('u1'), () => ({
        userId: 'u9',
        username: 'bob',
        fullName: 'Bob B',
      }));
      await svc.create({ table: 't', tableId: 'r1', type: ActionHistoryType.UPDATE });
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u9', username: 'bob', fullName: 'Bob B' }),
      );
    });

    it('writes through the queryRunner manager when one is supplied', async () => {
      const repo = makeRepoMock();
      const qrSave = jest.fn(async (e: unknown) => e);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const qr: any = { manager: { save: qrSave } };
      const svc = new ActionHistoryService(repo, ctx('u1'));
      await svc.create({ table: 't', tableId: 'r1', type: ActionHistoryType.DELETE }, qr);
      expect(qrSave).toHaveBeenCalled();
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('works without a ContextService (actor fields undefined)', async () => {
      const repo = makeRepoMock();
      const svc = new ActionHistoryService(repo);
      await svc.create({ table: 't', tableId: 'r1', type: ActionHistoryType.CREATE });
      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ table: 't', userId: undefined }));
    });
  });

  describe('record (IHistoryRecorder)', () => {
    it('maps a HistoryEntry to a create() call', async () => {
      const repo = makeRepoMock();
      const svc = new ActionHistoryService(repo, ctx('u1'));
      const entry: HistoryEntry = { table: 'deal', tableId: 'd1', type: 'UPDATE', fromData: { x: 1 }, toData: { x: 2 } };
      await svc.record(entry);
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ table: 'deal', tableId: 'd1', type: 'UPDATE', fromData: { x: 1 }, toData: { x: 2 } }),
      );
    });
  });

  describe('all', () => {
    it('maps rows to DTOs with createdAt serialized to ISO', async () => {
      const created = new Date('2026-01-02T03:04:05.000Z');
      const repo = makeRepoMock([
        { id: 'h1', table: 't', tableId: 'r1', userId: 'u1', type: ActionHistoryType.CREATE, createdAt: created },
      ]);
      const svc = new ActionHistoryService(repo, ctx('u1'));
      const dtos = await svc.all('r1');
      expect(repo.find).toHaveBeenCalledWith({ where: { tableId: 'r1' }, order: { createdAt: 'DESC' } });
      expect(dtos[0]).toMatchObject({ id: 'h1', tableId: 'r1', createdAt: '2026-01-02T03:04:05.000Z' });
    });
  });
});
