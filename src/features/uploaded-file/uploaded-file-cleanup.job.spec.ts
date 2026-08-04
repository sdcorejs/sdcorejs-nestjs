import { UploadedFileCleanupJob } from './uploaded-file-cleanup.job';

function makeService(purged = 0) {
  return {
    cleanupPendingUploads: jest.fn(async () => 0),
    cleanupExpiredTemporaryFiles: jest.fn(async () => 0),
    unsafeSystemPurgeUnusedBefore: jest.fn(async () => purged),
  };
}

describe('UploadedFileCleanupJob', () => {
  it('retries durable pending deletions even when age-based cleanup is disabled', async () => {
    const service = makeService(1);
    const job = new UploadedFileCleanupJob(service as never, {}, undefined);
    await job.tick();
    expect(service.cleanupPendingUploads).toHaveBeenCalledWith(100);
    expect(service.cleanupExpiredTemporaryFiles).toHaveBeenCalledWith(expect.any(Date), 100);
    expect(service.unsafeSystemPurgeUnusedBefore).not.toHaveBeenCalled();
  });

  it('uses the explicit system cleanup path instead of raw storage deletion', async () => {
    const service = makeService(2);
    const job = new UploadedFileCleanupJob(service as never, { cleanupAfterDays: 7 }, undefined);
    await job.tick();
    expect(service.cleanupPendingUploads).toHaveBeenCalledWith(100);
    expect(service.unsafeSystemPurgeUnusedBefore).toHaveBeenCalledWith(expect.any(Date));
  });

  it('continues bounded sweeps after a poison batch reports no finalizations', async () => {
    const service = makeService();
    service.cleanupPendingUploads.mockResolvedValueOnce(0).mockResolvedValueOnce(100).mockResolvedValueOnce(4);
    const job = new UploadedFileCleanupJob(service as never, {}, undefined);

    await job.tick();

    expect(service.cleanupPendingUploads).toHaveBeenCalledTimes(10);
    expect(service.cleanupPendingUploads).toHaveBeenNthCalledWith(1, 100);
    expect(service.cleanupPendingUploads).toHaveBeenNthCalledWith(3, 100);
    expect(service.cleanupPendingUploads).toHaveBeenNthCalledWith(10, 100);
  });

  it('runs the explicit cleanup under the distributed scheduler lock when available', async () => {
    const service = makeService(1);
    const runExclusive = jest.fn(async (_options: unknown, callback: () => Promise<void>) => callback());
    const job = new UploadedFileCleanupJob(service as never, { cleanupAfterDays: 7 }, { runExclusive } as never);
    await job.tick();
    expect(runExclusive).toHaveBeenCalledWith(expect.objectContaining({ code: 'uploaded-file-pending-cleanup' }), expect.any(Function));
    expect(service.unsafeSystemPurgeUnusedBefore).toHaveBeenCalledTimes(1);
  });

  it('registers both configured cron tracks and removes them during shutdown', () => {
    const service = makeService();
    const jobs = new Map<string, { start(): void; stop(): void; cronTime: { source: string } }>();
    const scheduler = {
      addCronJob: jest.fn((name: string, job: { start(): void; stop(): void; cronTime: { source: string } }) => jobs.set(name, job)),
      deleteCronJob: jest.fn((name: string) => {
        jobs.get(name)?.stop();
        jobs.delete(name);
      }),
    };
    const job = new UploadedFileCleanupJob(
      service as never,
      { pendingCleanupInterval: '5 * * * *', temporaryCleanupInterval: '*/10 * * * *' },
      undefined,
      scheduler as never,
    );

    job.onApplicationBootstrap();

    expect(scheduler.addCronJob).toHaveBeenCalledTimes(2);
    expect(scheduler.addCronJob).toHaveBeenCalledWith('uploaded-file-pending-cleanup', expect.any(Object));
    expect(scheduler.addCronJob).toHaveBeenCalledWith('uploaded-file-temporary-cleanup', expect.any(Object));
    expect(jobs.get('uploaded-file-pending-cleanup')?.cronTime.source).toBe('5 * * * *');
    expect(jobs.get('uploaded-file-temporary-cleanup')?.cronTime.source).toBe('*/10 * * * *');

    job.onApplicationShutdown();
    expect(scheduler.deleteCronJob).toHaveBeenCalledTimes(2);
    expect(jobs.size).toBe(0);
  });
});
