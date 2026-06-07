import 'reflect-metadata';
import type { DataSource } from 'typeorm';
import { JobScheduler, JobSchedulerService, JobSchedulerStatus, JobSchedulerType } from '@sdcorejs/nestjs/job-scheduler';
import { createTestDataSource } from '../../fixtures/pg-mem-datasource';

describe('JobSchedulerService distributed lock (pg-mem)', () => {
  let ds: DataSource;
  let svc: JobSchedulerService;

  beforeEach(async () => {
    ds = await createTestDataSource([JobScheduler]);
    svc = new JobSchedulerService(ds.getRepository(JobScheduler));
  });
  afterEach(async () => {
    await ds.destroy();
  });

  it('only the first acquire of a lockKey wins; the second is rejected by the unique constraint', async () => {
    const opts = { code: 'sync', runKey: 'tick-1', type: JobSchedulerType.SCHEDULE };
    const first = await svc.acquire(opts);
    const second = await svc.acquire(opts);
    expect(first.acquired).toBe(true);
    expect(first.id).toBeDefined();
    expect(second.acquired).toBe(false);
    expect(second.id).toBeUndefined();

    // Exactly one RUNNING row exists for this lock.
    const rows = await ds.getRepository(JobScheduler).find({ where: { lockKey: 'sync:tick-1' } });
    expect(rows).toHaveLength(1);
  });

  it('exactly one winner under concurrent acquire of the same lockKey', async () => {
    const opts = { code: 'cron', runKey: 'tick-9' };
    const results = await Promise.all(Array.from({ length: 8 }, () => svc.acquire(opts)));
    const winners = results.filter((r) => r.acquired);
    expect(winners).toHaveLength(1);
  });

  it('different runKeys are independent locks (next cron tick can run)', async () => {
    const a = await svc.acquire({ code: 'cron', runKey: 'tick-1' });
    const b = await svc.acquire({ code: 'cron', runKey: 'tick-2' });
    expect(a.acquired).toBe(true);
    expect(b.acquired).toBe(true);
  });

  it('INITIAL job (no runKey) runs once across the cluster', async () => {
    const first = await svc.acquire({ code: 'seed', type: JobSchedulerType.INITIAL });
    const second = await svc.acquire({ code: 'seed', type: JobSchedulerType.INITIAL });
    expect(first.acquired).toBe(true);
    expect(second.acquired).toBe(false);
  });

  it('runExclusive runs fn for the winner only and records SUCCESS', async () => {
    const fn = jest.fn(async () => 'done');
    const opts = { code: 'job', runKey: 'r1' };

    const won = await svc.runExclusive(opts, fn);
    const lost = await svc.runExclusive(opts, fn);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(won).toEqual({ acquired: true, result: 'done' });
    expect(lost.acquired).toBe(false);

    const row = await ds.getRepository(JobScheduler).findOne({ where: { lockKey: 'job:r1' } });
    expect(row?.status).toBe(JobSchedulerStatus.SUCCESS);
  });

  it('runExclusive marks FAIL and re-throws when fn throws', async () => {
    const opts = { code: 'job', runKey: 'r-fail' };
    await expect(
      svc.runExclusive(opts, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const row = await ds.getRepository(JobScheduler).findOne({ where: { lockKey: 'job:r-fail' } });
    expect(row?.status).toBe(JobSchedulerStatus.FAIL);
    expect(row?.data).toEqual({ error: 'Error: boom' });
  });
});
