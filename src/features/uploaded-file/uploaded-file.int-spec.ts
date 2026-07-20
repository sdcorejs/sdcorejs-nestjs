import 'reflect-metadata';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { In, type DataSource } from 'typeorm';
import { ContextService } from '../../core/context/context.service';
import { createTestDataSource } from '../../../test/fixtures/pg-mem-datasource';
import { normalizeUploadedFileConfig } from './config';
import type { UploadedFileStorageDriver, UploadedFileStorageWriteOptions } from './storage-driver';
import { UploadedFileService } from './services/uploaded-file.service';
import { LocalUploadedFileStorage } from './services/local.service';
import { UploadedFileCleanupJob } from './uploaded-file-cleanup.job';
import { UploadedFile } from './uploaded-file.entity';

const A1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const A2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const B1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';

class MemoryStorage implements UploadedFileStorageDriver {
  readonly objects = new Map<string, Buffer>();
  readonly deleted: string[] = [];
  failWrites = false;
  failDeletes = false;

  async write(key: string, buffer: Buffer, _options: UploadedFileStorageWriteOptions): Promise<void> {
    if (this.failWrites) throw new Error('simulated storage write outage');
    if (this.objects.has(key)) throw new Error('overwrite refused');
    this.objects.set(key, Buffer.from(buffer));
  }

  async download(key: string): Promise<Readable> {
    const value = this.objects.get(key);
    if (!value) throw new Error('missing');
    return Readable.from(value);
  }

  async delete(keys: readonly string[]): Promise<void> {
    if (this.failDeletes) throw new Error('simulated storage outage');
    for (const key of keys) {
      this.deleted.push(key);
      this.objects.delete(key);
    }
  }

  publicUrl(key: string): string {
    return `https://cdn.invalid/${key}`;
  }
}

async function streamText(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('UploadedFileService tenant/owner integration (pg-mem)', () => {
  let dataSource: DataSource;
  let context: ContextService;
  let storage: MemoryStorage;
  let service: UploadedFileService;

  beforeEach(async () => {
    dataSource = await createTestDataSource([UploadedFile]);
    context = new ContextService();
    storage = new MemoryStorage();
    service = new UploadedFileService(
      dataSource.getRepository(UploadedFile),
      storage,
      normalizeUploadedFileConfig({ allowedMimeTypes: ['text/plain'] }),
      context,
    );
  });

  afterEach(async () => dataSource.destroy());

  const as = <T>(tenant: string, userId: string, callback: () => Promise<T>): Promise<T> =>
    context.run({ tenant, userId, identitySource: 'verified-principal' }, callback);

  it('keeps same-name and concurrent uploads immutable for one tenant', async () => {
    const [first, second, third] = await as('tenant-a', A1, () =>
      Promise.all([
        service.upload(Buffer.from('first'), 'same.txt', undefined, undefined, { contentType: 'text/plain' }),
        service.upload(Buffer.from('second'), 'same.txt', undefined, undefined, { contentType: 'text/plain' }),
        service.upload(Buffer.from('third'), 'same.txt', undefined, undefined, { contentType: 'text/plain' }),
      ]),
    );

    expect(new Set([first.key, second.key, third.key]).size).toBe(3);
    expect(first.key).toContain('/tenant/');
    await expect(as('tenant-a', A1, async () => streamText((await service.download(first.id)).stream))).resolves.toBe('first');
    await expect(as('tenant-a', A1, async () => streamText((await service.download(second.id)).stream))).resolves.toBe('second');
  });

  it('uses distinct tenant namespaces and denies cross-tenant UUID knowledge', async () => {
    const tenantA = await as('tenant-a', A1, () =>
      service.upload(Buffer.from('a'), 'same.txt', undefined, undefined, { contentType: 'text/plain' }),
    );
    const tenantB = await as('tenant-b', B1, () =>
      service.upload(Buffer.from('b'), 'same.txt', undefined, undefined, { contentType: 'text/plain' }),
    );

    expect(tenantA.key).not.toBe(tenantB.key);
    await expect(as('tenant-b', B1, () => service.download(tenantA.id))).rejects.toMatchObject({ status: 404 });
    await expect(as('tenant-a', A1, () => service.download(tenantB.id))).rejects.toMatchObject({ status: 404 });
  });

  it('denies same-tenant non-owners for read/update/mark/delete without touching storage', async () => {
    const owned = await as('tenant-a', A1, () =>
      service.upload(Buffer.from('private'), 'private.txt', undefined, undefined, { contentType: 'text/plain' }),
    );

    await expect(as('tenant-a', A2, () => service.findById(owned.id))).rejects.toMatchObject({ status: 404 });
    await expect(as('tenant-a', A2, () => service.setExtraData(owned.id, { forged: true }))).rejects.toMatchObject({ status: 404 });
    await expect(as('tenant-a', A2, () => service.markUsed([owned.id]))).rejects.toMatchObject({ status: 404 });
    await expect(as('tenant-a', A2, () => service.delete([owned.key]))).rejects.toMatchObject({ status: 404 });
    expect(storage.objects.get(owned.key)?.toString()).toBe('private');
    expect(storage.deleted).toEqual([]);
  });

  it('rolls back a mixed-owner batch instead of partially mutating authorized rows', async () => {
    const first = await as('tenant-a', A1, () =>
      service.upload(Buffer.from('one'), 'one.txt', undefined, undefined, { contentType: 'text/plain' }),
    );
    const second = await as('tenant-a', A2, () =>
      service.upload(Buffer.from('two'), 'two.txt', undefined, undefined, { contentType: 'text/plain' }),
    );

    await expect(as('tenant-a', A1, () => service.markUsed([first.id, second.id]))).rejects.toMatchObject({ status: 404 });
    const rows = await dataSource.getRepository(UploadedFile).findBy({ id: In([first.id, second.id]) });
    expect(rows).toHaveLength(2);
    expect(rows.every(({ isUsed }) => isUsed === false)).toBe(true);
  });

  it('allows an explicit same-tenant sharing policy without weakening tenant scope', async () => {
    const owned = await as('tenant-a', A1, () =>
      service.upload(Buffer.from('shared'), 'shared.txt', undefined, undefined, { contentType: 'text/plain' }),
    );
    const sharedService = new UploadedFileService(
      dataSource.getRepository(UploadedFile),
      storage,
      normalizeUploadedFileConfig({
        allowedMimeTypes: ['text/plain'],
        authorizationPolicy: ({ operation }) => (operation === 'read' ? 'tenant' : 'owner'),
      }),
      context,
    );

    await expect(as('tenant-a', A2, () => sharedService.findById(owned.id))).resolves.toMatchObject({ id: owned.id });
    await expect(as('tenant-b', B1, () => sharedService.findById(owned.id))).rejects.toMatchObject({ status: 404 });
  });

  it('deletes only the exact authorized object for duplicate original names', async () => {
    const first = await as('tenant-a', A1, () =>
      service.upload(Buffer.from('first'), 'same.txt', undefined, undefined, { contentType: 'text/plain' }),
    );
    const second = await as('tenant-a', A1, () =>
      service.upload(Buffer.from('second'), 'same.txt', undefined, undefined, { contentType: 'text/plain' }),
    );

    await as('tenant-a', A1, () => service.delete([first.key]));
    expect(storage.objects.has(first.key)).toBe(false);
    expect(storage.objects.get(second.key)?.toString()).toBe('second');
    await expect(as('tenant-a', A1, async () => streamText((await service.download(second.id)).stream))).resolves.toBe('second');
  });

  it('keeps a durable hidden deletion-pending row and finalizes it after a retry', async () => {
    const uploaded = await as('tenant-a', A1, () =>
      service.upload(Buffer.from('pending'), 'pending.txt', undefined, undefined, { contentType: 'text/plain' }),
    );
    storage.failDeletes = true;

    await expect(as('tenant-a', A1, () => service.delete([uploaded.key]))).rejects.toMatchObject({ status: 400 });

    const pending = await dataSource.getRepository(UploadedFile).findOne({ where: { id: uploaded.id }, withDeleted: true });
    expect(pending).toMatchObject({ id: uploaded.id, deletedAt: null });
    expect(pending?.deletionPendingAt).toBeInstanceOf(Date);
    expect(pending!.deletionPendingAt!.getTime()).toBeGreaterThan(Date.now());
    expect(storage.objects.has(uploaded.key)).toBe(true);
    await expect(as('tenant-a', A1, () => service.findById(uploaded.id))).rejects.toMatchObject({ status: 404 });

    storage.failDeletes = false;
    await dataSource
      .getRepository(UploadedFile)
      .update({ id: uploaded.id, deletionPendingAt: pending!.deletionPendingAt! }, { deletionPendingAt: new Date(Date.now() - 1) });
    await new UploadedFileCleanupJob(service, {}, undefined).tick();
    await expect(service.unsafeSystemRetryPendingDeletions(10)).resolves.toBe(0);

    const finalized = await dataSource.getRepository(UploadedFile).findOne({ where: { id: uploaded.id }, withDeleted: true });
    expect(finalized?.deletedAt).toBeInstanceOf(Date);
    expect(storage.objects.has(uploaded.key)).toBe(false);
  });

  it('backs off a full poison batch so the next bounded sweep reaches row 101', async () => {
    const startedAt = new Date('2026-07-20T00:00:00.000Z');
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    jest.setSystemTime(startedAt);
    const repository = dataSource.getRepository(UploadedFile);
    const rows = repository.create(
      Array.from({ length: 101 }, (_, index) => ({
        tenantCode: 'tenant-a',
        fileName: `pending-${index.toString().padStart(3, '0')}.txt`,
        key: `pending-${index.toString().padStart(3, '0')}`,
        cdn: `uploaded-file/pending-${index.toString().padStart(3, '0')}/download`,
        userId: A1,
        isUsed: false,
        uploadPendingAt: null,
        deletionPendingAt: new Date(startedAt.getTime() - 10_000 + index),
      })),
    );
    await repository.save(rows);
    const tailKey = 'pending-100';
    const attempted: string[] = [];
    const actualDelete = storage.delete.bind(storage);
    const remove = jest.spyOn(storage, 'delete').mockImplementation(async (keys) => {
      attempted.push(...keys);
      if (keys[0] !== tailKey) throw new Error('simulated poison object');
      await actualDelete(keys);
    });
    const loggerError = jest
      .spyOn((service as unknown as { logger: { error(message: string): void } }).logger, 'error')
      .mockImplementation(() => undefined);

    try {
      await expect(service.unsafeSystemRetryPendingDeletions(100)).resolves.toBe(0);
      expect(attempted).toHaveLength(100);
      expect(attempted).not.toContain(tailKey);

      const backedOff = await repository.findOneByOrFail({ key: 'pending-000' });
      expect(backedOff.deletionPendingAt).toBeInstanceOf(Date);
      expect(backedOff.deletionPendingAt!.getTime()).toBeGreaterThan(Date.now());

      await expect(service.unsafeSystemRetryPendingDeletions(100)).resolves.toBe(1);
      expect(attempted).toHaveLength(101);
      expect(attempted.at(-1)).toBe(tailKey);
      const finalizedTail = await repository.findOneOrFail({ where: { key: tailKey }, withDeleted: true });
      expect(finalizedTail.deletedAt).toBeInstanceOf(Date);
      expect(finalizedTail.deletionPendingAt).toBeNull();
    } finally {
      loggerError.mockRestore();
      remove.mockRestore();
      jest.useRealTimers();
    }
  });

  it('tracks an object when activation and compensating deletion fail, then retries safely', async () => {
    const repository = dataSource.getRepository(UploadedFile);
    const actualUpdate = repository.update.bind(repository);
    const update = jest.spyOn(repository, 'update').mockImplementation(async (criteria, partial) => {
      if (
        (partial as { uploadPendingAt?: Date | null }).uploadPendingAt === null &&
        (partial as { deletionPendingAt?: Date | null }).deletionPendingAt === undefined
      ) {
        throw new Error('simulated activation outage');
      }
      return actualUpdate(criteria, partial);
    });
    storage.failDeletes = true;

    await expect(
      as('tenant-a', A1, () => service.upload(Buffer.from('tracked'), 'tracked.txt', undefined, undefined, { contentType: 'text/plain' })),
    ).rejects.toMatchObject({ status: 400 });
    update.mockRestore();

    const pending = await repository.findOne({ where: { fileName: 'tracked.txt' }, withDeleted: true });
    expect(pending?.deletionPendingAt).toBeInstanceOf(Date);
    expect(pending!.deletionPendingAt!.getTime()).toBeGreaterThan(Date.now());
    expect(pending?.deletedAt).toBeNull();
    expect(storage.objects.has(pending!.key)).toBe(true);
    await expect(as('tenant-a', A1, () => service.findById(pending!.id))).rejects.toMatchObject({ status: 404 });

    storage.failDeletes = false;
    await repository.update(
      { id: pending!.id, deletionPendingAt: pending!.deletionPendingAt! },
      { deletionPendingAt: new Date(Date.now() - 1) },
    );
    await expect(service.unsafeSystemRetryPendingDeletions(10)).resolves.toBe(1);
    const finalized = await repository.findOne({ where: { id: pending!.id }, withDeleted: true });
    expect(finalized?.deletedAt).toBeInstanceOf(Date);
    expect(storage.objects.has(pending!.key)).toBe(false);
  });

  it('confirms success when activation commits but its database response is lost', async () => {
    const repository = dataSource.getRepository(UploadedFile);
    const actualUpdate = repository.update.bind(repository);
    const update = jest.spyOn(repository, 'update').mockImplementation(async (criteria, partial) => {
      const result = await actualUpdate(criteria, partial);
      if (
        (partial as { uploadPendingAt?: Date | null }).uploadPendingAt === null &&
        (partial as { deletionPendingAt?: Date | null }).deletionPendingAt === undefined
      ) {
        throw new Error('simulated lost activation response');
      }
      return result;
    });

    const uploaded = await as('tenant-a', A1, () =>
      service.upload(Buffer.from('confirmed'), 'confirmed.txt', undefined, undefined, { contentType: 'text/plain' }),
    );
    update.mockRestore();

    expect(uploaded).toMatchObject({ fileName: 'confirmed.txt', uploadPendingAt: null, deletionPendingAt: null });
    expect(storage.objects.get(uploaded.key)?.toString()).toBe('confirmed');
    await expect(as('tenant-a', A1, () => service.findById(uploaded.id))).resolves.toMatchObject({ id: uploaded.id });
    expect(storage.deleted).toEqual([]);
  });

  it('prevents a delayed ambiguous activation from reclaiming a row owned by compensating cleanup', async () => {
    const repository = dataSource.getRepository(UploadedFile);
    const actualUpdate = repository.update.bind(repository);
    const activationObserved = deferred();
    const runLateActivation = deferred();
    const deletionStarted = deferred();
    const finishDeletion = deferred();
    let lateActivation: Promise<void> | undefined;
    let activationAffected: number | null | undefined;
    let activationMarker: Date | undefined;

    const update = jest.spyOn(repository, 'update').mockImplementation(async (criteria, partial) => {
      if (
        (partial as { uploadPendingAt?: Date | null }).uploadPendingAt === null &&
        (partial as { deletionPendingAt?: Date | null }).deletionPendingAt === undefined
      ) {
        activationMarker = (criteria as { uploadPendingAt?: Date }).uploadPendingAt;
        activationObserved.resolve();
        lateActivation = (async () => {
          await runLateActivation.promise;
          activationAffected = (await actualUpdate(criteria, partial)).affected;
        })();
        throw new Error('simulated ambiguous activation response');
      }
      return actualUpdate(criteria, partial);
    });
    const actualDelete = storage.delete.bind(storage);
    const remove = jest.spyOn(storage, 'delete').mockImplementation(async (keys) => {
      deletionStarted.resolve();
      await finishDeletion.promise;
      await actualDelete(keys);
    });

    const upload = as('tenant-a', A1, () =>
      service.upload(Buffer.from('ambiguous'), 'ambiguous.txt', undefined, undefined, { contentType: 'text/plain' }),
    );
    const rejectedUpload = expect(upload).rejects.toMatchObject({ status: 400 });
    await activationObserved.promise;
    await deletionStarted.promise;

    const claimed = await repository.findOneOrFail({ where: { fileName: 'ambiguous.txt' }, withDeleted: true });
    expect(claimed.deletionPendingAt).toBeInstanceOf(Date);
    expect(claimed.deletionPendingAt?.getTime()).not.toBe(activationMarker?.getTime());

    runLateActivation.resolve();
    await lateActivation;
    expect(activationAffected).toBe(0);
    await expect(as('tenant-a', A1, () => service.findById(claimed.id))).rejects.toMatchObject({ status: 404 });

    finishDeletion.resolve();
    await rejectedUpload;
    const finalized = await repository.findOneOrFail({ where: { id: claimed.id }, withDeleted: true });
    expect(finalized.deletedAt).toBeInstanceOf(Date);
    expect(storage.objects.has(claimed.key)).toBe(false);
    update.mockRestore();
    remove.mockRestore();
  });

  it('retains an unresolved-upload tombstone across sweeps, then removes late-written bytes', async () => {
    const startedAt = new Date('2026-07-20T00:00:00.000Z');
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    jest.setSystemTime(startedAt);
    const repository = dataSource.getRepository(UploadedFile);
    const actualUpdate = repository.update.bind(repository);
    let activationAffected: number | null | undefined;
    let activationMarker: Date | null = null;
    const update = jest.spyOn(repository, 'update').mockImplementation(async (criteria, partial) => {
      const result = await actualUpdate(criteria, partial);
      if (
        (partial as { uploadPendingAt?: Date | null }).uploadPendingAt === null &&
        (partial as { deletionPendingAt?: Date | null }).deletionPendingAt === undefined &&
        activationMarker &&
        (criteria as { uploadPendingAt?: Date }).uploadPendingAt?.getTime() === activationMarker.getTime()
      ) {
        activationAffected = result.affected;
      }
      return result;
    });
    const writeStarted = deferred();
    const finishWrite = deferred();
    const actualWrite = storage.write.bind(storage);
    const write = jest.spyOn(storage, 'write').mockImplementation(async (...args) => {
      writeStarted.resolve();
      await finishWrite.promise;
      await actualWrite(...args);
    });

    try {
      const upload = as('tenant-a', A1, () =>
        service.upload(Buffer.from('late-write'), 'late-write.txt', undefined, undefined, { contentType: 'text/plain' }),
      );
      const rejectedUpload = expect(upload).rejects.toMatchObject({ status: 400 });
      await writeStarted.promise;
      const pending = await repository.findOneOrFail({ where: { fileName: 'late-write.txt' }, withDeleted: true });
      activationMarker = pending.uploadPendingAt;
      expect(activationMarker).toBeInstanceOf(Date);

      jest.setSystemTime(new Date(startedAt.getTime() + 16 * 60 * 1000));
      await expect(service.unsafeSystemRetryPendingDeletions(10)).resolves.toBe(1);
      const finalizedBeforeWrite = await repository.findOneOrFail({ where: { id: pending.id }, withDeleted: true });
      expect(finalizedBeforeWrite.deletedAt).toBeInstanceOf(Date);
      expect(finalizedBeforeWrite.uploadPendingAt?.getTime()).toBe(activationMarker?.getTime());
      expect(finalizedBeforeWrite.deletionPendingAt).toBeInstanceOf(Date);
      expect(storage.objects.has(pending.key)).toBe(false);

      // Simulate a producer process that remains dead/pending beyond another cleanup lease. The
      // tombstone stays durable and is rescheduled instead of being cleared or starving silently.
      jest.setSystemTime(new Date(startedAt.getTime() + 32 * 60 * 1000));
      await expect(service.unsafeSystemRetryPendingDeletions(10)).resolves.toBe(1);
      const retained = await repository.findOneOrFail({ where: { id: pending.id }, withDeleted: true });
      expect(retained.deletedAt).toBeInstanceOf(Date);
      expect(retained.uploadPendingAt?.getTime()).toBe(activationMarker?.getTime());
      expect(retained.deletionPendingAt).toBeInstanceOf(Date);

      finishWrite.resolve();
      await rejectedUpload;
      expect(activationAffected).toBe(0);
      expect(storage.objects.has(pending.key)).toBe(false);
      expect(storage.deleted.filter((key) => key === pending.key)).toHaveLength(3);

      const maintenanceClaim = update.mock.calls.find(
        ([criteria, partial]) =>
          (criteria as { uploadPendingAt?: Date }).uploadPendingAt?.getTime() === activationMarker?.getTime() &&
          (partial as { deletionPendingAt?: Date | null }).deletionPendingAt instanceof Date,
      );
      expect(maintenanceClaim).toBeDefined();
      expect((maintenanceClaim?.[1] as { deletionPendingAt: Date }).deletionPendingAt.getTime()).not.toBe(activationMarker?.getTime());
    } finally {
      finishWrite.resolve();
      update.mockRestore();
      write.mockRestore();
      jest.useRealTimers();
    }
  });

  it('restores durable retry state when terminal cleanup of a late object write fails', async () => {
    const startedAt = new Date('2026-07-20T00:00:00.000Z');
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    jest.setSystemTime(startedAt);
    const repository = dataSource.getRepository(UploadedFile);
    const writeStarted = deferred();
    const finishWrite = deferred();
    const actualWrite = storage.write.bind(storage);
    const write = jest.spyOn(storage, 'write').mockImplementation(async (...args) => {
      writeStarted.resolve();
      await finishWrite.promise;
      await actualWrite(...args);
    });
    const actualDelete = storage.delete.bind(storage);
    let deleteAttempts = 0;
    let failTerminalDelete = true;
    const remove = jest.spyOn(storage, 'delete').mockImplementation(async (keys) => {
      deleteAttempts += 1;
      if (deleteAttempts === 2 && failTerminalDelete) throw new Error('simulated terminal storage outage');
      await actualDelete(keys);
    });

    try {
      const upload = as('tenant-a', A1, () =>
        service.upload(Buffer.from('late-retry'), 'late-retry.txt', undefined, undefined, { contentType: 'text/plain' }),
      );
      const rejectedUpload = expect(upload).rejects.toMatchObject({ status: 400 });
      await writeStarted.promise;
      const pending = await repository.findOneOrFail({ where: { fileName: 'late-retry.txt' }, withDeleted: true });

      jest.setSystemTime(new Date(startedAt.getTime() + 16 * 60 * 1000));
      await expect(service.unsafeSystemRetryPendingDeletions(10)).resolves.toBe(1);
      expect((await repository.findOneOrFail({ where: { id: pending.id }, withDeleted: true })).deletedAt).toBeInstanceOf(Date);

      finishWrite.resolve();
      await rejectedUpload;
      const retryable = await repository.findOneOrFail({ where: { id: pending.id }, withDeleted: true });
      expect(retryable.deletedAt).toBeNull();
      expect(retryable.deletionPendingAt).toBeInstanceOf(Date);
      expect(retryable.deletionPendingAt!.getTime()).toBeGreaterThan(Date.now());
      expect(storage.objects.get(pending.key)?.toString()).toBe('late-retry');

      failTerminalDelete = false;
      jest.setSystemTime(new Date(startedAt.getTime() + 18 * 60 * 1000));
      await expect(service.unsafeSystemRetryPendingDeletions(10)).resolves.toBe(1);
      const finalized = await repository.findOneOrFail({ where: { id: pending.id }, withDeleted: true });
      expect(finalized.deletedAt).toBeInstanceOf(Date);
      expect(storage.objects.has(pending.key)).toBe(false);
    } finally {
      finishWrite.resolve();
      write.mockRestore();
      remove.mockRestore();
      jest.useRealTimers();
    }
  });

  it('invalidates a paused maintenance finalization before a failed terminal delete can orphan bytes', async () => {
    const startedAt = new Date('2026-07-20T00:00:00.000Z');
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    jest.setSystemTime(startedAt);
    const repository = dataSource.getRepository(UploadedFile);
    const writeStarted = deferred();
    const finishWrite = deferred();
    const actualWrite = storage.write.bind(storage);
    const write = jest.spyOn(storage, 'write').mockImplementation(async (...args) => {
      writeStarted.resolve();
      await finishWrite.promise;
      await actualWrite(...args);
    });
    const actualDelete = storage.delete.bind(storage);
    let deleteAttempts = 0;
    let failTerminalDelete = true;
    const remove = jest.spyOn(storage, 'delete').mockImplementation(async (keys) => {
      deleteAttempts += 1;
      if (deleteAttempts === 2 && failTerminalDelete) throw new Error('simulated terminal storage outage');
      await actualDelete(keys);
    });
    const finalizationStarted = deferred();
    const finishFinalization = deferred();
    const actualSoftDelete = repository.softDelete.bind(repository);
    let pauseFirstFinalization = true;
    const softDelete = jest.spyOn(repository, 'softDelete').mockImplementation(async (criteria) => {
      if (pauseFirstFinalization) {
        pauseFirstFinalization = false;
        finalizationStarted.resolve();
        await finishFinalization.promise;
      }
      return actualSoftDelete(criteria);
    });

    try {
      const upload = as('tenant-a', A1, () =>
        service.upload(Buffer.from('paused-finalize'), 'paused-finalize.txt', undefined, undefined, { contentType: 'text/plain' }),
      );
      const rejectedUpload = expect(upload).rejects.toMatchObject({ status: 400 });
      await writeStarted.promise;
      const pending = await repository.findOneOrFail({ where: { fileName: 'paused-finalize.txt' }, withDeleted: true });

      jest.setSystemTime(new Date(startedAt.getTime() + 16 * 60 * 1000));
      const maintenance = service.unsafeSystemRetryPendingDeletions(10);
      const lostMaintenanceClaim = expect(maintenance).resolves.toBe(0);
      await finalizationStarted.promise;

      finishWrite.resolve();
      await rejectedUpload;
      const retryableBeforeFinalize = await repository.findOneOrFail({ where: { id: pending.id }, withDeleted: true });
      expect(retryableBeforeFinalize.deletedAt).toBeNull();
      expect(retryableBeforeFinalize.deletionPendingAt).toBeInstanceOf(Date);
      expect(retryableBeforeFinalize.deletionPendingAt!.getTime()).toBeGreaterThan(Date.now());
      expect(storage.objects.get(pending.key)?.toString()).toBe('paused-finalize');

      finishFinalization.resolve();
      await lostMaintenanceClaim;
      const retryable = await repository.findOneOrFail({ where: { id: pending.id }, withDeleted: true });
      expect(retryable.deletedAt).toBeNull();
      expect(retryable.deletionPendingAt?.getTime()).toBe(retryableBeforeFinalize.deletionPendingAt?.getTime());

      failTerminalDelete = false;
      jest.setSystemTime(new Date(startedAt.getTime() + 18 * 60 * 1000));
      await expect(service.unsafeSystemRetryPendingDeletions(10)).resolves.toBe(1);
      const finalized = await repository.findOneOrFail({ where: { id: pending.id }, withDeleted: true });
      expect(finalized.deletedAt).toBeInstanceOf(Date);
      expect(finalized.deletionPendingAt).toBeNull();
      expect(storage.objects.has(pending.key)).toBe(false);
    } finally {
      finishWrite.resolve();
      finishFinalization.resolve();
      write.mockRestore();
      remove.mockRestore();
      softDelete.mockRestore();
      jest.useRealTimers();
    }
  });

  it('skips storage deletion when a maintenance selection loses its exact-marker claim', async () => {
    const uploaded = await as('tenant-a', A1, () =>
      service.upload(Buffer.from('stale-worker'), 'stale-worker.txt', undefined, undefined, { contentType: 'text/plain' }),
    );
    const repository = dataSource.getRepository(UploadedFile);
    const expiredMarker = new Date(Date.now() - 1_000);
    await repository.update({ id: uploaded.id }, { deletionPendingAt: expiredMarker });

    const selectionReady = deferred();
    const returnSelection = deferred();
    const actualFind = repository.find.bind(repository);
    let intercepted = false;
    const find = jest.spyOn(repository, 'find').mockImplementation(async (options) => {
      const rows = await actualFind(options);
      if (!intercepted) {
        intercepted = true;
        selectionReady.resolve();
        await returnSelection.promise;
      }
      return rows;
    });

    const retry = service.unsafeSystemRetryPendingDeletions(10);
    await selectionReady.promise;
    const replacementMarker = new Date(Date.now() + 60_000);
    const replacement = await repository.update(
      { id: uploaded.id, deletionPendingAt: expiredMarker },
      { deletionPendingAt: replacementMarker },
    );
    expect(replacement.affected).toBe(1);
    returnSelection.resolve();

    await expect(retry).resolves.toBe(0);
    expect(storage.objects.get(uploaded.key)?.toString()).toBe('stale-worker');
    expect(storage.deleted).toEqual([]);
    const row = await repository.findOneByOrFail({ id: uploaded.id });
    expect(row.deletionPendingAt?.getTime()).toBe(replacementMarker.getTime());
    find.mockRestore();
  });

  it('retires an operator-verified upload tombstone into ordinary deletion retry state', async () => {
    const uploaded = await as('tenant-a', A1, () =>
      service.upload(Buffer.from('retire'), 'retire.txt', undefined, undefined, { contentType: 'text/plain' }),
    );
    const repository = dataSource.getRepository(UploadedFile);
    const liveUploadLease = new Date(Date.now() + 60_000);
    await repository.update({ id: uploaded.id }, { uploadPendingAt: liveUploadLease, deletionPendingAt: null });
    await expect(service.unsafeSystemRetireUploadTombstone(uploaded.id)).resolves.toBe(false);

    const expiredUpload = new Date(Date.now() - 2_000);
    const expiredDeletion = new Date(Date.now() - 1_000);
    await repository.update({ id: uploaded.id }, { uploadPendingAt: expiredUpload, deletionPendingAt: expiredDeletion });
    await repository.softDelete({ id: uploaded.id });

    await expect(service.unsafeSystemRetireUploadTombstone(uploaded.id)).resolves.toBe(true);
    const retryable = await repository.findOneOrFail({ where: { id: uploaded.id }, withDeleted: true });
    expect(retryable.deletedAt).toBeNull();
    expect(retryable.uploadPendingAt).toBeNull();
    expect(retryable.deletionPendingAt).toBeInstanceOf(Date);
    expect(retryable.deletionPendingAt!.getTime()).toBeLessThan(Date.now());

    await expect(service.unsafeSystemRetryPendingDeletions(10)).resolves.toBe(1);
    const finalized = await repository.findOneOrFail({ where: { id: uploaded.id }, withDeleted: true });
    expect(finalized.deletedAt).toBeInstanceOf(Date);
    expect(finalized.deletionPendingAt).toBeNull();
    expect(storage.objects.has(uploaded.key)).toBe(false);
  });

  it('tracks temporary local objects as unused rows and removes them through cleanup', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sdcore-temp-lifecycle-'));
    try {
      const config = normalizeUploadedFileConfig({
        localRoot: root,
        allowedMimeTypes: ['text/plain'],
        cleanupAfterDays: 1,
      });
      const localStorage = new LocalUploadedFileStorage(config);
      const localService = new UploadedFileService(dataSource.getRepository(UploadedFile), localStorage, config, context);
      const temporary = await as('tenant-a', A1, () =>
        localService.uploadTemporary(Buffer.from('temporary'), 'temporary.txt', { contentType: 'text/plain' }),
      );
      const row = await dataSource.getRepository(UploadedFile).findOneByOrFail({ key: temporary.key });
      expect(row).toMatchObject({ isUsed: false, type: 'temporary' });
      await expect(streamText(await localStorage.download(temporary.key))).resolves.toBe('temporary');

      await expect(localService.unsafeSystemPurgeUnusedBefore(new Date(Date.now() + 1_000))).resolves.toBe(1);
      await expect(localStorage.download(temporary.key)).rejects.toMatchObject({ code: 'ENOENT' });
      const finalized = await dataSource.getRepository(UploadedFile).findOne({ where: { id: row.id }, withDeleted: true });
      expect(finalized?.deletedAt).toBeInstanceOf(Date);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('keeps a temporary write failure durably tracked until storage cleanup can retry', async () => {
    const config = normalizeUploadedFileConfig({ allowedMimeTypes: ['text/plain'], cleanupAfterDays: 1 });
    const temporaryService = new UploadedFileService(dataSource.getRepository(UploadedFile), storage, config, context);
    storage.failWrites = true;
    storage.failDeletes = true;

    await expect(
      as('tenant-a', A1, () => temporaryService.uploadTemporary(Buffer.from('temporary'), 'temporary.txt', { contentType: 'text/plain' })),
    ).rejects.toMatchObject({ status: 400 });

    const pending = await dataSource.getRepository(UploadedFile).findOne({ where: { type: 'temporary' }, withDeleted: true });
    expect(pending?.deletionPendingAt).toBeInstanceOf(Date);
    expect(pending!.deletionPendingAt!.getTime()).toBeGreaterThan(Date.now());
    expect(pending?.deletedAt).toBeNull();
    await expect(as('tenant-a', A1, () => temporaryService.findById(pending!.id))).rejects.toMatchObject({ status: 404 });

    storage.failWrites = false;
    storage.failDeletes = false;
    await dataSource
      .getRepository(UploadedFile)
      .update({ id: pending!.id, deletionPendingAt: pending!.deletionPendingAt! }, { deletionPendingAt: new Date(Date.now() - 1) });
    await new UploadedFileCleanupJob(temporaryService, config, undefined).tick();
    const finalized = await dataSource.getRepository(UploadedFile).findOne({ where: { id: pending!.id }, withDeleted: true });
    expect(finalized?.deletedAt).toBeInstanceOf(Date);
  });

  it('fails closed without trusted tenant/owner context', async () => {
    await expect(service.upload(Buffer.from('x'), 'x.txt', undefined, undefined, { contentType: 'text/plain' })).rejects.toMatchObject({
      status: 404,
    });
  });
});
