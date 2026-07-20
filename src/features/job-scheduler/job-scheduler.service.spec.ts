/* eslint-disable @typescript-eslint/no-explicit-any */
import 'reflect-metadata';
import { JobSchedulerService } from './job-scheduler.service';
import { InvalidJobIdentityOptionsError, InvalidJobLeaseOptionsError, JobSchedulerStatus, JobSchedulerType } from './types';

/**
 * Mock repository whose `createQueryBuilder()` supports BOTH the insert chain and the update chain.
 * `insert` / `update` control what each chain's `execute()` returns as `raw` rows. Every
 * `createQueryBuilder()` call gets a fresh builder, pushed to `__builders` for assertions.
 */
function makeRepo({
  insert = [],
  update = [],
  affected = 1,
}: {
  insert?: Array<{ id: string }>;
  update?: Array<{ id: string }>;
  affected?: number;
} = {}) {
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
      execute: jest.fn(async () => ({ raw: kind === 'update' ? update : insert, affected: kind === 'update' ? affected : undefined })),
    };
    return qb;
  };
  const repo: any = {
    createQueryBuilder: jest.fn(() => {
      const qb = makeQb();
      builders.push(qb);
      return qb;
    }),
    __builders: builders,
  };
  return repo;
}

describe('JobSchedulerService', () => {
  describe('acquire (atomic single-winner, FAIL-retryable)', () => {
    it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.5, null])('rejects unsafe leaseMs=%s before issuing SQL', async (leaseMs) => {
      const repo = makeRepo();
      const svc = new JobSchedulerService(repo);
      await expect(svc.acquire({ code: 'unsafe', leaseMs: leaseMs as any })).rejects.toBeInstanceOf(InvalidJobLeaseOptionsError);
      expect(repo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, 500, null])(
      'rejects unsafe heartbeatMs=%s for a 1000ms lease before issuing SQL',
      async (heartbeatMs) => {
        const repo = makeRepo();
        const svc = new JobSchedulerService(repo);
        await expect(svc.acquire({ code: 'unsafe', leaseMs: 1000, heartbeatMs: heartbeatMs as any })).rejects.toBeInstanceOf(
          InvalidJobLeaseOptionsError,
        );
        expect(repo.createQueryBuilder).not.toHaveBeenCalled();
      },
    );

    it('returns the stable idempotency key for the winner and inserts RUNNING with that lock key', async () => {
      const repo = makeRepo({ insert: [{ id: 'j1' }] });
      const svc = new JobSchedulerService(repo);
      const res = await svc.acquire({ code: 'sync', runKey: '2026-01-01T00:00', type: JobSchedulerType.SCHEDULE });
      expect(res).toMatchObject({
        acquired: true,
        id: 'j1',
        ownerToken: expect.any(String),
        idempotencyKey: expect.stringMatching(/^v2:[A-Za-z0-9_-]{43}$/),
      });
      const insertQb = repo.__builders[0];
      expect(insertQb.orIgnore).toHaveBeenCalled(); // ON CONFLICT DO NOTHING
      expect(insertQb.values.mock.calls[0][0]).toMatchObject({
        lockKey: expect.stringMatching(/^v2:[A-Za-z0-9_-]{43}$/),
        code: 'sync',
        status: JobSchedulerStatus.RUNNING,
        ownerToken: res.ownerToken,
      });
      expect(insertQb.values.mock.calls[0][0].lockKey).toBe(res.idempotencyKey);
    });

    it('uses a deterministic versioned digest for INITIAL (no runKey)', async () => {
      const repo = makeRepo({ insert: [{ id: 'j1' }] });
      const svc = new JobSchedulerService(repo);
      await svc.acquire({ code: 'seed', type: JobSchedulerType.INITIAL });
      expect(repo.__builders[0].values.mock.calls[0][0].lockKey).toMatch(/^v2:[A-Za-z0-9_-]{43}$/);
    });

    it.each([
      [{ code: ' ', runKey: 'tick' }, 'code'],
      [{ code: 'scheduled' }, 'runKey'],
      [{ code: 'scheduled', runKey: '' }, 'runKey'],
      [{ code: 'initial', type: JobSchedulerType.INITIAL, runKey: 'unexpected' }, 'runKey'],
    ] as const)('rejects ambiguous job identity %p before SQL', async (options, expected) => {
      const repo = makeRepo();
      const svc = new JobSchedulerService(repo);
      await expect(svc.acquire(options)).rejects.toThrow(expected);
      await expect(svc.acquire(options)).rejects.toBeInstanceOf(InvalidJobIdentityOptionsError);
      expect(repo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it.each([
      [{ code: 42, runKey: 'tick' }, 'code'],
      [{ code: 'scheduled', runKey: 42 }, 'runKey'],
      [{ code: 'scheduled', type: 'UNKNOWN', runKey: 'tick' }, 'type'],
      [{ code: 'scheduled', type: null, runKey: 'tick' }, 'type'],
    ])('rejects malformed JavaScript identity %p with a domain error before SQL', async (options, expected) => {
      const repo = makeRepo();
      const svc = new JobSchedulerService(repo);
      await expect(svc.acquire(options as any)).rejects.toThrow(expected);
      await expect(svc.acquire(options as any)).rejects.toBeInstanceOf(InvalidJobIdentityOptionsError);
      expect(repo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it.each([null, undefined])('rejects missing JavaScript options (%s) with a domain error before SQL', async (options) => {
      const repo = makeRepo();
      const svc = new JobSchedulerService(repo);
      await expect(svc.acquire(options as any)).rejects.toBeInstanceOf(InvalidJobIdentityOptionsError);
      expect(repo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('does not collide for tuples that shared the legacy colon-concatenated key', async () => {
      const repo = makeRepo({ insert: [{ id: 'j1' }] });
      const svc = new JobSchedulerService(repo);
      await svc.acquire({ code: 'a:b', type: JobSchedulerType.INITIAL });
      await svc.acquire({ code: 'a', runKey: 'b', type: JobSchedulerType.SCHEDULE });
      const firstKey = repo.__builders[0].values.mock.calls[0][0].lockKey;
      const secondKey = repo.__builders[1].values.mock.calls[0][0].lockKey;
      expect(firstKey).not.toBe(secondKey);
    });

    it('re-claims a previously FAILED run (insert conflict, conditional update matches) → acquired', async () => {
      const repo = makeRepo({ insert: [], update: [{ id: 'jF' }] });
      const svc = new JobSchedulerService(repo);
      const res = await svc.acquire({ code: 'seed', type: JobSchedulerType.INITIAL });
      expect(res).toMatchObject({ acquired: true, id: 'jF', ownerToken: expect.any(String), idempotencyKey: expect.any(String) });
      // second builder = the conditional UPDATE; must set RUNNING and filter on FAIL status.
      const updateQb = repo.__builders[1];
      expect(updateQb.set).toHaveBeenCalledWith(
        expect.objectContaining({ status: JobSchedulerStatus.RUNNING, ownerToken: res.ownerToken }),
      );
      expect(updateQb.where.mock.calls[0][1]).toMatchObject({ failed: JobSchedulerStatus.FAIL });
    });

    it('does NOT re-claim a SUCCESS/RUNNING run (insert conflict, update matches nothing) → not acquired', async () => {
      const repo = makeRepo({ insert: [], update: [] });
      const svc = new JobSchedulerService(repo);
      const res = await svc.acquire({ code: 'seed', type: JobSchedulerType.INITIAL });
      expect(res).toEqual({ acquired: false });
    });

    it('re-claims a STALE RUNNING run (lease expired → crashed node) via the conditional update', async () => {
      const repo = makeRepo({ insert: [], update: [{ id: 'jStale' }] });
      const svc = new JobSchedulerService(repo);
      const res = await svc.acquire({ code: 'seed', type: JobSchedulerType.INITIAL, leaseMs: 1000 });
      expect(res).toMatchObject({ acquired: true, id: 'jStale', ownerToken: expect.any(String), idempotencyKey: expect.any(String) });
      const whereParams = repo.__builders[1].where.mock.calls[0][1];
      expect(whereParams).toMatchObject({ failed: JobSchedulerStatus.FAIL, running: JobSchedulerStatus.RUNNING });
      expect(whereParams.leaseInterval).toBe('1000 milliseconds');
      expect(repo.__builders[1].where.mock.calls[0][0]).toContain('CURRENT_TIMESTAMP');
    });
  });

  describe('runExclusive', () => {
    it.each([null, undefined])('rejects missing JavaScript options (%s) before invoking the callback', async (options) => {
      const repo = makeRepo();
      const svc = new JobSchedulerService(repo);
      const fn = jest.fn(async () => undefined);

      await expect(svc.runExclusive(options as any, fn)).rejects.toBeInstanceOf(InvalidJobIdentityOptionsError);
      expect(fn).not.toHaveBeenCalled();
      expect(repo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('derives a heartbeat safely below a shortened lease', async () => {
      const repo = makeRepo({ insert: [{ id: 'j1' }] });
      const svc = new JobSchedulerService(repo);
      const interval = jest.spyOn(global, 'setInterval');
      try {
        await svc.runExclusive({ code: 'c', runKey: 'short', leaseMs: 90_000 }, async () => undefined);
        expect(interval).toHaveBeenCalledWith(expect.any(Function), 30_000);
      } finally {
        interval.mockRestore();
      }
    });

    it('runs fn + marks SUCCESS when the lock is won', async () => {
      const repo = makeRepo({ insert: [{ id: 'j1' }] });
      const svc = new JobSchedulerService(repo);
      const fn = jest.fn(async () => 42);
      const res = await svc.runExclusive({ code: 'c', runKey: 'r' }, fn);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith({
        id: 'j1',
        ownerToken: expect.any(String),
        idempotencyKey: expect.stringMatching(/^v2:[A-Za-z0-9_-]{43}$/),
      });
      expect(res).toEqual({ acquired: true, result: 42 });
      const finalizeQb = repo.__builders[1];
      expect(finalizeQb.set).toHaveBeenCalledWith({ status: JobSchedulerStatus.SUCCESS, data: null });
      expect(finalizeQb.where.mock.calls[0][1]).toMatchObject({ id: 'j1', ownerToken: expect.any(String), running: 'RUNNING' });
    });

    it('does NOT run fn and returns acquired:false when the lock is lost', async () => {
      const repo = makeRepo({ insert: [], update: [] });
      const svc = new JobSchedulerService(repo);
      const fn = jest.fn(async () => 42);
      const res = await svc.runExclusive({ code: 'c', runKey: 'r' }, fn);
      expect(fn).not.toHaveBeenCalled();
      expect(res).toEqual({ acquired: false });
      expect(repo.__builders).toHaveLength(2);
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
      const failQb = repo.__builders[1];
      expect(failQb.set).toHaveBeenCalledWith({ status: JobSchedulerStatus.FAIL, data: { error: 'Error: boom' } });
      expect(failQb.where.mock.calls[0][1]).toMatchObject({ id: 'j1', ownerToken: expect.any(String), running: 'RUNNING' });
    });
  });

  describe('lease mutations', () => {
    const lease = { id: 'j1', ownerToken: '11111111-1111-4111-8111-111111111111' };

    it('updates status + data only for the current RUNNING owner', async () => {
      const repo = makeRepo({ affected: 1 });
      const svc = new JobSchedulerService(repo);
      await expect(svc.complete(lease, { ok: true })).resolves.toBe(true);
      const qb = repo.__builders[0];
      expect(qb.set).toHaveBeenCalledWith({ status: JobSchedulerStatus.SUCCESS, data: { ok: true } });
      expect(qb.where.mock.calls[0][0]).toContain('"ownerToken" = :ownerToken');
      expect(qb.where.mock.calls[0][0]).toContain('status = :running');
      expect(qb.where.mock.calls[0][1]).toEqual({ id: lease.id, ownerToken: lease.ownerToken, running: JobSchedulerStatus.RUNNING });
    });

    it('heartbeats with the database clock rather than a worker-local timestamp', async () => {
      const repo = makeRepo({ affected: 1 });
      const svc = new JobSchedulerService(repo);
      await expect(svc.heartbeat(lease)).resolves.toBe(true);
      const expression = repo.__builders[0].set.mock.calls[0][0].modifiedAt;
      expect(expression()).toBe('CURRENT_TIMESTAMP');
    });

    it('returns false when a stale owner affects zero rows', async () => {
      const repo = makeRepo({ affected: 0 });
      const svc = new JobSchedulerService(repo);
      await expect(svc.heartbeat(lease)).resolves.toBe(false);
      await expect(svc.complete(lease)).resolves.toBe(false);
      await expect(svc.fail(lease)).resolves.toBe(false);
      await expect(svc.release(lease)).resolves.toBe(false);
    });
  });
});
