import { UploadedFileCleanupJob } from './uploaded-file-cleanup.job';

function makeService(purged = 0) {
  return {
    unsafeSystemRetryPendingDeletions: jest.fn(async () => 0),
    unsafeSystemPurgeUnusedBefore: jest.fn(async () => purged),
  };
}

describe('UploadedFileCleanupJob', () => {
  it('retries durable pending deletions even when age-based cleanup is disabled', async () => {
    const service = makeService(1);
    const job = new UploadedFileCleanupJob(service as never, {}, undefined);
    await job.tick();
    expect(service.unsafeSystemRetryPendingDeletions).toHaveBeenCalledWith(100);
    expect(service.unsafeSystemPurgeUnusedBefore).not.toHaveBeenCalled();
  });

  it('uses the explicit system cleanup path instead of raw storage deletion', async () => {
    const service = makeService(2);
    const job = new UploadedFileCleanupJob(service as never, { cleanupAfterDays: 7 }, undefined);
    await job.tick();
    expect(service.unsafeSystemRetryPendingDeletions).toHaveBeenCalledWith(100);
    expect(service.unsafeSystemPurgeUnusedBefore).toHaveBeenCalledWith(expect.any(Date));
  });

  it('continues bounded sweeps after a poison batch reports no finalizations', async () => {
    const service = makeService();
    service.unsafeSystemRetryPendingDeletions.mockResolvedValueOnce(0).mockResolvedValueOnce(100).mockResolvedValueOnce(4);
    const job = new UploadedFileCleanupJob(service as never, {}, undefined);

    await job.tick();

    expect(service.unsafeSystemRetryPendingDeletions).toHaveBeenCalledTimes(10);
    expect(service.unsafeSystemRetryPendingDeletions).toHaveBeenNthCalledWith(1, 100);
    expect(service.unsafeSystemRetryPendingDeletions).toHaveBeenNthCalledWith(3, 100);
    expect(service.unsafeSystemRetryPendingDeletions).toHaveBeenNthCalledWith(10, 100);
  });

  it('runs the explicit cleanup under the distributed scheduler lock when available', async () => {
    const service = makeService(1);
    const runExclusive = jest.fn(async (_options: unknown, callback: () => Promise<void>) => callback());
    const job = new UploadedFileCleanupJob(service as never, { cleanupAfterDays: 7 }, { runExclusive } as never);
    await job.tick();
    expect(runExclusive).toHaveBeenCalledWith(expect.objectContaining({ code: 'uploaded-file-orphan-cleanup' }), expect.any(Function));
    expect(service.unsafeSystemPurgeUnusedBefore).toHaveBeenCalledTimes(1);
  });
});
