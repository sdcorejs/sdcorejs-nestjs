import { UploadedFileCleanupJob } from './uploaded-file-cleanup.job';

type Orphan = { cdn: string };

function makeRepo(orphans: Orphan[]) {
  const qb = {
    where: jest.fn().mockReturnThis(),
    getMany: jest.fn(async () => orphans),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { createQueryBuilder: jest.fn(() => qb) } as any;
}

function makeStorage() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { changeFiles: jest.fn(async () => undefined) } as any;
}

describe('UploadedFileCleanupJob', () => {
  it('does nothing when cleanupAfterDays is unset (disabled)', async () => {
    const storage = makeStorage();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const j = new UploadedFileCleanupJob(makeRepo([{ cdn: 'a' }]), storage, {}, undefined as any);
    await j.tick();
    expect(storage.changeFiles).not.toHaveBeenCalled();
  });

  it('does nothing when cleanupAfterDays <= 0', async () => {
    const storage = makeStorage();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const j = new UploadedFileCleanupJob(makeRepo([{ cdn: 'a' }]), storage, { cleanupAfterDays: 0 }, undefined as any);
    await j.tick();
    expect(storage.changeFiles).not.toHaveBeenCalled();
  });

  it('purges orphan cdns directly when no JobSchedulerService is wired', async () => {
    const repo = makeRepo([{ cdn: 'cdn/a' }, { cdn: 'cdn/b' }]);
    const storage = makeStorage();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const j = new UploadedFileCleanupJob(repo, storage, { cleanupAfterDays: 7 }, undefined as any);
    await j.tick();
    expect(storage.changeFiles).toHaveBeenCalledWith(['cdn/a', 'cdn/b'], []);
  });

  it('skips the purge call when there are no orphans', async () => {
    const storage = makeStorage();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const j = new UploadedFileCleanupJob(makeRepo([]), storage, { cleanupAfterDays: 7 }, undefined as any);
    await j.tick();
    expect(storage.changeFiles).not.toHaveBeenCalled();
  });

  it('runs under the distributed lock when JobSchedulerService is available', async () => {
    const repo = makeRepo([{ cdn: 'cdn/a' }]);
    const storage = makeStorage();
    const runExclusive = jest.fn(async (_opts: unknown, fn: () => Promise<void>) => {
      await fn();
      return { ran: true };
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const j = new UploadedFileCleanupJob(repo, storage, { cleanupAfterDays: 7 }, { runExclusive } as any);
    await j.tick();
    expect(runExclusive).toHaveBeenCalledTimes(1);
    expect(runExclusive.mock.calls[0][0]).toMatchObject({ code: 'uploaded-file-orphan-cleanup' });
    expect(storage.changeFiles).toHaveBeenCalledWith(['cdn/a'], []);
  });
});
