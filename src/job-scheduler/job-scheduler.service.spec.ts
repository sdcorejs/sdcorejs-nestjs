/* eslint-disable @typescript-eslint/no-explicit-any */
import 'reflect-metadata';
import { JobSchedulerService } from './job-scheduler.service';
import { JobSchedulerStatus, JobSchedulerType } from './types';

/**
 * Mock repository whose `createQueryBuilder()` supports BOTH the insert chain and the update chain.
 * `insert` / `update` control what each chain's `execute()` returns as `raw` rows. Every
 * `createQueryBuilder()` call gets a fresh builder, pushed to `__builders` for assertions.
 */
function makeRepo({ insert = [], update = [] }: { insert?: Array<{ id: string }>; update?: Array<{ id: string }> } = {}) {
  const builders: any[] = [];
  const makeQb = () => {
    let kind: 'insert' | 'update' | null = null;
    const qb: any = {
      insert: jest.fn(() => ((kind = 'insert'), qb)),
      update: jest.fn(() => ((kind = 'update'), qb)),
      into: jest.fn(() => qb),
      set: jest.fn(() => qb),
      values: jest.fn(() => qb),
      orIgnore: jest.fn(() => qb),
      where: jest.fn(() => qb),
      returning: jest.fn(() => qb),
      execute: jest.fn(async () => ({ raw: kind === 'update' ? update : insert })),
    };
    return qb;
  };
  const repo: any = {
    createQueryBuilder: jest.fn(() => {
      const qb = makeQb();
      builders.push(qb);
      return qb;
    }),
    update: jest.fn(async () => ({ affected: 1 })),
    __builders: builders,
  };
  return repo;
}

describe('JobSchedulerService', () => {
  describe('acquire (atomic single-winner, FAIL-retryable)', () => {
    it('returns acquired:true + id for the winner and inserts RUNNING with the runKey lock key', async () => {
      const repo = makeRepo({ insert: [{ id: 'j1' }] });
      const svc = new JobSchedulerService(repo);
      const res = await svc.acquire({ code: 'sync', runKey: '2026-01-01T00:00', type: JobSchedulerType.SCHEDULE });
      expect(res).toEqual({ acquired: true, id: 'j1' });
      const insertQb = repo.__builders[0];
      expect(insertQb.orIgnore).toHaveBeenCalled(); // ON CONFLICT DO NOTHING
      expect(insertQb.values.mock.calls[0][0]).toMatchObject({
        lockKey: 'sync:2026-01-01T00:00',
        code: 'sync',
        status: JobSchedulerStatus.RUNNING,
      });
    });

    it('uses code as the lock key for INITIAL (no runKey)', async () => {
      const repo = makeRepo({ insert: [{ id: 'j1' }] });
      const svc = new JobSchedulerService(repo);
      await svc.acquire({ code: 'seed', type: JobSchedulerType.INITIAL });
      expect(repo.__builders[0].values.mock.calls[0][0].lockKey).toBe('seed');
    });

    it('re-claims a previously FAILED run (insert conflict, conditional update matches) → acquired', async () => {
      const repo = makeRepo({ insert: [], update: [{ id: 'jF' }] });
      const svc = new JobSchedulerService(repo);
      const res = await svc.acquire({ code: 'seed', type: JobSchedulerType.INITIAL });
      expect(res).toEqual({ acquired: true, id: 'jF' });
      // second builder = the conditional UPDATE; must set RUNNING and filter on FAIL status.
      const updateQb = repo.__builders[1];
      expect(updateQb.set).toHaveBeenCalledWith(expect.objectContaining({ status: JobSchedulerStatus.RUNNING }));
      expect(updateQb.where.mock.calls[0][1]).toMatchObject({ failed: JobSchedulerStatus.FAIL });
    });

    it('does NOT re-claim a SUCCESS/RUNNING run (insert conflict, update matches nothing) → not acquired', async () => {
      const repo = makeRepo({ insert: [], update: [] });
      const svc = new JobSchedulerService(repo);
      const res = await svc.acquire({ code: 'seed', type: JobSchedulerType.INITIAL });
      expect(res).toEqual({ acquired: false });
    });
  });

  describe('runExclusive', () => {
    it('runs fn + marks SUCCESS when the lock is won', async () => {
      const repo = makeRepo({ insert: [{ id: 'j1' }] });
      const svc = new JobSchedulerService(repo);
      const fn = jest.fn(async () => 42);
      const res = await svc.runExclusive({ code: 'c', runKey: 'r' }, fn);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(res).toEqual({ acquired: true, result: 42 });
      expect(repo.update).toHaveBeenCalledWith('j1', { status: JobSchedulerStatus.SUCCESS, data: null });
    });

    it('does NOT run fn and returns acquired:false when the lock is lost', async () => {
      const repo = makeRepo({ insert: [], update: [] });
      const svc = new JobSchedulerService(repo);
      const fn = jest.fn(async () => 42);
      const res = await svc.runExclusive({ code: 'c', runKey: 'r' }, fn);
      expect(fn).not.toHaveBeenCalled();
      expect(res).toEqual({ acquired: false });
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('marks FAIL and re-throws when fn throws', async () => {
      const repo = makeRepo({ insert: [{ id: 'j1' }] });
      const svc = new JobSchedulerService(repo);
      const boom = new Error('boom');
      await expect(
        svc.runExclusive({ code: 'c', runKey: 'r' }, async () => {
          throw boom;
        }),
      ).rejects.toBe(boom);
      expect(repo.update).toHaveBeenCalledWith('j1', { status: JobSchedulerStatus.FAIL, data: { error: 'Error: boom' } });
    });
  });

  describe('complete', () => {
    it('updates status + data', async () => {
      const repo = makeRepo({ insert: [] });
      const svc = new JobSchedulerService(repo);
      await svc.complete('j1', JobSchedulerStatus.SUCCESS, { ok: true });
      expect(repo.update).toHaveBeenCalledWith('j1', { status: JobSchedulerStatus.SUCCESS, data: { ok: true } });
    });
  });
});
