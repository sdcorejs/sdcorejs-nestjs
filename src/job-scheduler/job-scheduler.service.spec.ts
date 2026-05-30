import 'reflect-metadata';
import { JobSchedulerService } from './job-scheduler.service';
import { JobSchedulerStatus, JobSchedulerType } from './types';

function makeRepo(insertRaw: Array<{ id: string }>) {
  const qb = {
    insert: jest.fn().mockReturnThis(),
    into: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
    orIgnore: jest.fn().mockReturnThis(),
    returning: jest.fn().mockReturnThis(),
    execute: jest.fn(async () => ({ raw: insertRaw })),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const repo: any = {
    createQueryBuilder: jest.fn(() => qb),
    update: jest.fn(async () => ({ affected: 1 })),
    __qb: qb,
  };
  return repo;
}

describe('JobSchedulerService', () => {
  describe('acquire (atomic single-winner)', () => {
    it('returns acquired:true + id for the winner, and inserts RUNNING with the runKey lock key', async () => {
      const repo = makeRepo([{ id: 'j1' }]);
      const svc = new JobSchedulerService(repo);
      const res = await svc.acquire({ code: 'sync', runKey: '2026-01-01T00:00', type: JobSchedulerType.SCHEDULE });
      expect(res).toEqual({ acquired: true, id: 'j1' });
      expect(repo.__qb.orIgnore).toHaveBeenCalled(); // ON CONFLICT DO NOTHING
      const values = repo.__qb.values.mock.calls[0][0];
      expect(values).toMatchObject({ lockKey: 'sync:2026-01-01T00:00', code: 'sync', status: JobSchedulerStatus.RUNNING });
    });

    it('returns acquired:false when the insert hits a conflict (another node won)', async () => {
      const repo = makeRepo([]);
      const svc = new JobSchedulerService(repo);
      const res = await svc.acquire({ code: 'sync', runKey: 't1' });
      expect(res).toEqual({ acquired: false });
    });

    it('uses code as the lock key for INITIAL (no runKey)', async () => {
      const repo = makeRepo([{ id: 'j1' }]);
      const svc = new JobSchedulerService(repo);
      await svc.acquire({ code: 'seed', type: JobSchedulerType.INITIAL });
      expect(repo.__qb.values.mock.calls[0][0].lockKey).toBe('seed');
    });
  });

  describe('runExclusive', () => {
    it('runs fn + marks SUCCESS when the lock is won', async () => {
      const repo = makeRepo([{ id: 'j1' }]);
      const svc = new JobSchedulerService(repo);
      const fn = jest.fn(async () => 42);
      const res = await svc.runExclusive({ code: 'c', runKey: 'r' }, fn);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(res).toEqual({ acquired: true, result: 42 });
      expect(repo.update).toHaveBeenCalledWith('j1', { status: JobSchedulerStatus.SUCCESS, data: null });
    });

    it('does NOT run fn and returns acquired:false when the lock is lost', async () => {
      const repo = makeRepo([]);
      const svc = new JobSchedulerService(repo);
      const fn = jest.fn(async () => 42);
      const res = await svc.runExclusive({ code: 'c', runKey: 'r' }, fn);
      expect(fn).not.toHaveBeenCalled();
      expect(res).toEqual({ acquired: false });
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('marks FAIL and re-throws when fn throws', async () => {
      const repo = makeRepo([{ id: 'j1' }]);
      const svc = new JobSchedulerService(repo);
      const boom = new Error('boom');
      await expect(svc.runExclusive({ code: 'c', runKey: 'r' }, async () => { throw boom; })).rejects.toBe(boom);
      expect(repo.update).toHaveBeenCalledWith('j1', { status: JobSchedulerStatus.FAIL, data: { error: 'Error: boom' } });
    });
  });

  describe('complete', () => {
    it('updates status + data', async () => {
      const repo = makeRepo([]);
      const svc = new JobSchedulerService(repo);
      await svc.complete('j1', JobSchedulerStatus.SUCCESS, { ok: true });
      expect(repo.update).toHaveBeenCalledWith('j1', { status: JobSchedulerStatus.SUCCESS, data: { ok: true } });
    });
  });
});
