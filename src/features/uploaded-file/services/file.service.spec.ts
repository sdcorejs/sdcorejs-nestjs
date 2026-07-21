import 'reflect-metadata';
import { Readable } from 'node:stream';
import type { Repository } from 'typeorm';
import { ContextService } from '../../../core/context/context.service';
import { normalizeUploadedFileConfig } from '../config';
import type { UploadedFileStorageDriver } from '../storage-driver';
import { UploadedFile } from '../uploaded-file.entity';
import { UploadedFileService } from './uploaded-file.service';

const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function makeStorage(): jest.Mocked<UploadedFileStorageDriver> {
  return {
    write: jest.fn(async () => undefined),
    download: jest.fn(async () => Readable.from('content')),
    delete: jest.fn(async () => undefined),
    publicUrl: jest.fn((key) => `https://cdn.test/${key}`),
  };
}

function makeRepository(overrides: Partial<Record<'save' | 'findOne' | 'find' | 'update' | 'softDelete', jest.Mock>> = {}) {
  const repository: Record<string, unknown> = {
    create: jest.fn((entity: unknown) => entity),
    save: overrides.save ?? jest.fn(async (entity: unknown) => entity),
    findOne: overrides.findOne ?? jest.fn(async () => null),
    find: overrides.find ?? jest.fn(async () => []),
    update: overrides.update ?? jest.fn(async () => ({ affected: 1 })),
    softDelete: overrides.softDelete ?? jest.fn(async () => ({ affected: 1 })),
  };
  repository.manager = {
    transaction: jest.fn(async (callback: (manager: { getRepository(): unknown }) => Promise<unknown>) =>
      callback({ getRepository: () => repository }),
    ),
  };
  return repository as unknown as jest.Mocked<Repository<UploadedFile>>;
}

function setup(
  repository = makeRepository(),
  storage = makeStorage(),
  config = normalizeUploadedFileConfig({ allowedMimeTypes: ['text/plain'] }),
) {
  const context = new ContextService();
  const service = new UploadedFileService(repository, storage, config, context);
  const run = <T>(callback: () => Promise<T>): Promise<T> =>
    context.run({ tenant: 'tenant-a', userId: USER_ID, identitySource: 'verified-principal' }, callback);
  return { service, repository, storage, context, run };
}

describe('UploadedFileService', () => {
  it('generates a private tenant UUID key and keeps the original name only as metadata', async () => {
    const { service, repository, storage, run } = setup();
    const row = await run(() =>
      service.upload(Buffer.from('hello'), '../Invoice 01.txt', undefined, undefined, { contentType: 'text/plain' }),
    );

    expect(row.fileName).toBe('Invoice 01.txt');
    expect(row.key).toMatch(/^core\/tenant\/[A-Za-z0-9_-]+\/[0-9a-f-]{36}\/invoice-01\.txt$/);
    expect(row.cdn).toMatch(/^uploaded-file\/[0-9a-f-]{36}\/download$/);
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ tenantCode: 'tenant-a', userId: USER_ID, fileName: 'Invoice 01.txt', key: row.key }),
    );
    expect(storage.write).toHaveBeenCalledWith(row.key, expect.any(Buffer), expect.objectContaining({ contentType: 'text/plain' }));
  });

  it('enforces size and signature before any storage write', async () => {
    const { service, storage, run } = setup(
      undefined,
      undefined,
      normalizeUploadedFileConfig({ maxFileSizeBytes: 4, allowedMimeTypes: ['text/plain'] }),
    );
    await expect(
      run(() => service.upload(Buffer.alloc(5, 0x61), 'a.txt', undefined, undefined, { contentType: 'text/plain' })),
    ).rejects.toMatchObject({
      status: 400,
    });

    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    await expect(run(() => service.upload(png, 'a.txt', undefined, undefined, { contentType: 'text/plain' }))).rejects.toMatchObject({
      status: 400,
    });
    expect(storage.write).not.toHaveBeenCalled();
  });

  it('persists durable tracking before writing bytes so a database failure cannot orphan an object', async () => {
    const repository = makeRepository({ save: jest.fn(async () => Promise.reject(new Error('private SQL detail'))) });
    const { service, storage, run } = setup(repository);
    const failure = run(() => service.upload(Buffer.from('hello'), 'a.txt', undefined, undefined, { contentType: 'text/plain' }));
    await expect(failure).rejects.toMatchObject({ status: 400, response: expect.not.objectContaining({ data: expect.anything() }) });
    expect(storage.write).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('does not delete bytes after an ambiguous activation result unless pending ownership is confirmed', async () => {
    const repository = makeRepository({
      update: jest
        .fn()
        .mockRejectedValueOnce(new Error('activation response lost'))
        .mockResolvedValueOnce({ affected: 0, raw: [], generatedMaps: [] }),
    });
    const storage = makeStorage();
    const { service, run } = setup(repository, storage);

    await expect(
      run(() => service.upload(Buffer.from('hello'), 'a.txt', undefined, undefined, { contentType: 'text/plain' })),
    ).rejects.toMatchObject({ status: 400 });

    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({ uploadPendingAt: expect.any(Date), deletionPendingAt: null }));
    expect(storage.write).toHaveBeenCalledTimes(1);
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('returns the active row when activation committed but its response was lost', async () => {
    const active = { id: '00000000-0000-4000-8000-000000000001', fileName: 'a.txt', key: 'confirmed-key', cdn: 'confirmed-url' };
    const repository = makeRepository({
      update: jest.fn().mockRejectedValueOnce(new Error('activation response lost')),
      findOne: jest.fn(async () => active),
    });
    const storage = makeStorage();
    const { service, run } = setup(repository, storage);

    await expect(
      run(() => service.upload(Buffer.from('hello'), 'a.txt', undefined, undefined, { contentType: 'text/plain' })),
    ).resolves.toBe(active);
    expect(storage.write).toHaveBeenCalledTimes(1);
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('adds tenant and owner to metadata lookup and returns the same 404 for no match', async () => {
    const repository = makeRepository();
    const { service, run } = setup(repository);
    await expect(run(() => service.findById('00000000-0000-4000-8000-000000000001'))).rejects.toMatchObject({ status: 404 });
    expect(repository.findOne).toHaveBeenCalledWith({
      where: expect.objectContaining({ tenantCode: 'tenant-a', userId: USER_ID, id: '00000000-0000-4000-8000-000000000001' }),
    });
  });

  it('rejects malformed IDs and scope values before executing storage or repository operations', async () => {
    const { service, repository, storage, context } = setup();

    await expect(context.run({ tenant: 'tenant-a', userId: USER_ID }, () => service.findById(undefined as never))).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      context.run({ tenant: 'tenant-a', userId: 'not-a-uuid' }, () =>
        service.upload(Buffer.from('hello'), 'a.txt', undefined, undefined, { contentType: 'text/plain' }),
      ),
    ).rejects.toMatchObject({ status: 404 });

    expect(repository.findOne).not.toHaveBeenCalled();
    expect(storage.write).not.toHaveBeenCalled();
  });

  it('checks affected rows for scoped mutations', async () => {
    const repository = makeRepository({ update: jest.fn(async () => ({ affected: 0, raw: [], generatedMaps: [] })) });
    const { service, run } = setup(repository);
    await expect(run(() => service.setExtraData('00000000-0000-4000-8000-000000000001', { a: 1 }))).rejects.toMatchObject({ status: 404 });
    expect(repository.update).toHaveBeenCalledWith(
      expect.objectContaining({ tenantCode: 'tenant-a', userId: USER_ID, id: '00000000-0000-4000-8000-000000000001' }),
      { extraData: { a: 1 } },
    );
  });

  it('allowlists mark-used metadata instead of mass assigning runtime keys', async () => {
    const id = '00000000-0000-4000-8000-000000000001';
    const repository = makeRepository({ find: jest.fn(async () => [{ id }]) });
    const { service, run } = setup(repository);
    await run(() => service.markUsed([id], { entity: 'brand', tenantCode: 'forged' } as never));

    const update = repository.update.mock.calls.at(-1)?.[1] as Record<string, unknown>;
    expect(update).toMatchObject({ isUsed: true, entity: 'brand' });
    expect(update).not.toHaveProperty('tenantCode');
  });

  it('validates every batch item and cap before policy or SQL execution', async () => {
    const policy = jest.fn(() => 'owner' as const);
    const config = normalizeUploadedFileConfig({ allowedMimeTypes: ['text/plain'], authorizationPolicy: policy });
    const { service, repository, run } = setup(undefined, undefined, config);
    const validId = '00000000-0000-4000-8000-000000000001';

    await expect(run(() => service.markUsed([validId, 'not-a-uuid']))).rejects.toMatchObject({ status: 404 });
    await expect(run(() => service.delete(Array.from({ length: 101 }, (_, index) => `key-${index}`)))).rejects.toMatchObject({
      status: 404,
    });
    await expect(run(() => service.useFiles(['x'.repeat(1025)]))).rejects.toMatchObject({ status: 404 });

    expect(policy).not.toHaveBeenCalled();
    expect(repository.find).not.toHaveBeenCalled();
    expect(repository.update).not.toHaveBeenCalled();
    expect(repository.manager.transaction).not.toHaveBeenCalled();
  });

  it('uses an explicit policy decision but always retains the tenant predicate', async () => {
    const id = '00000000-0000-4000-8000-000000000001';
    const repository = makeRepository({ findOne: jest.fn(async () => ({ id, key: 'k', fileName: 'a.txt' })) });
    const config = normalizeUploadedFileConfig({
      allowedMimeTypes: ['text/plain'],
      authorizationPolicy: () => 'tenant',
    });
    const { service, run } = setup(repository, undefined, config);
    await run(() => service.findById(id));
    const where = repository.findOne.mock.calls[0][0].where;
    expect(where).toEqual(expect.objectContaining({ id, tenantCode: 'tenant-a' }));
    expect(where).not.toHaveProperty('userId');
  });

  it('keeps remote clone disabled by default before any network request', async () => {
    const { service, run } = setup();
    await expect(run(() => service.cloneFromUrl('https://example.com/a.txt'))).rejects.toMatchObject({ status: 400 });
  });

  it('fails temporary uploads closed when durable cleanup is not configured', async () => {
    const { service, storage, repository, run } = setup();

    await expect(
      run(() => service.uploadTemporary(Buffer.from('temporary'), 'temporary.txt', { contentType: 'text/plain' })),
    ).rejects.toMatchObject({ status: 400 });

    expect(storage.write).not.toHaveBeenCalled();
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('prioritizes ordinary deletion claims before unresolved tombstones at the batch limit', async () => {
    const ordinary = {
      id: '00000000-0000-4000-8000-000000000001',
      key: 'ordinary-key',
      uploadPendingAt: null,
      deletionPendingAt: new Date(Date.now() - 1_000),
      deletedAt: null,
    } as UploadedFile;
    const repository = makeRepository({ find: jest.fn(async () => [ordinary]) });
    const storage = makeStorage();
    const { service } = setup(repository, storage);

    await expect(service.unsafeSystemRetryPendingDeletions(1)).resolves.toBe(1);

    expect(repository.find).toHaveBeenCalledTimes(1);
    expect(repository.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ uploadPendingAt: expect.anything() }), take: 1, withDeleted: true }),
    );
    expect(storage.delete).toHaveBeenCalledWith(['ordinary-key']);
  });

  it('shares remaining maintenance capacity between initial and retry upload tombstones', async () => {
    const uploadMarker = new Date(Date.now() - 60_000);
    const retryMarker = new Date(Date.now() - 30_000);
    const initial = {
      id: '00000000-0000-4000-8000-000000000001',
      key: 'initial-tombstone-key',
      uploadPendingAt: uploadMarker,
      deletionPendingAt: null,
      deletedAt: null,
    } as UploadedFile;
    const retry = {
      id: '00000000-0000-4000-8000-000000000002',
      key: 'retry-tombstone-key',
      uploadPendingAt: uploadMarker,
      deletionPendingAt: retryMarker,
      deletedAt: null,
    } as UploadedFile;
    const repository = makeRepository({
      find: jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([initial]).mockResolvedValueOnce([retry]),
    });
    const storage = makeStorage();
    const { service } = setup(repository, storage);

    await expect(service.unsafeSystemRetryPendingDeletions(2)).resolves.toBe(2);

    expect(repository.find).toHaveBeenCalledTimes(3);
    expect(storage.delete).toHaveBeenCalledTimes(2);
    expect(storage.delete).toHaveBeenCalledWith(['initial-tombstone-key']);
    expect(storage.delete).toHaveBeenCalledWith(['retry-tombstone-key']);
  });

  it('persists temporary tracking before writing bytes so a database failure cannot orphan an object', async () => {
    const repository = makeRepository({ save: jest.fn(async () => Promise.reject(new Error('database unavailable'))) });
    const config = normalizeUploadedFileConfig({ allowedMimeTypes: ['text/plain'], cleanupAfterDays: 1 });
    const { service, storage, run } = setup(repository, undefined, config);

    await expect(
      run(() => service.uploadTemporary(Buffer.from('temporary'), 'temporary.txt', { contentType: 'text/plain' })),
    ).rejects.toMatchObject({ status: 400 });

    expect(storage.write).not.toHaveBeenCalled();
  });

  it('returns attachment content headers for known types', () => {
    const { service } = setup();
    expect(service.getContent('invoice.pdf')).toMatchObject({ ContentType: 'application/pdf' });
    expect(service.getContent('unknown.bin')).toEqual({});
  });
});
