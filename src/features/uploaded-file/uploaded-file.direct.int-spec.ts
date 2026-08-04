import 'reflect-metadata';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { DataSource } from 'typeorm';
import { ContextService } from '../../core/context/context.service';
import { createTestDataSource } from '../../../test/fixtures/pg-mem-datasource';
import { normalizeUploadedFileConfig } from './config';
import type {
  UploadedFileStorageDownloadUrlRequest,
  UploadedFileStorageDriver,
  UploadedFileStorageObjectMetadata,
  UploadedFileStoragePromoteRequest,
  UploadedFileStorageSource,
  UploadedFileStorageUploadTarget,
  UploadedFileStorageUploadUrlRequest,
  UploadedFileStorageWriteOptions,
} from './storage-driver';
import type { InitiateUploadedFileInput, InitiateUploadedFileResult, UploadedFileResult } from './types';
import { UploadedFileService } from './services/uploaded-file.service';
import { LocalUploadedFileStorage } from './services/local.service';
import { UploadedFile } from './uploaded-file.entity';

const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ENTITY_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

class DirectMemoryStorage implements UploadedFileStorageDriver {
  readonly kind = 's3' as const;
  readonly objects = new Map<string, Buffer>();
  readonly contentTypes = new Map<string, string>();
  readonly metadata = new Map<string, Record<string, string>>();
  readonly uploadRequests: UploadedFileStorageUploadUrlRequest[] = [];
  readonly promotions: UploadedFileStoragePromoteRequest[] = [];
  readonly downloadRequests: UploadedFileStorageDownloadUrlRequest[] = [];
  readonly deleted: string[] = [];
  failDelete = false;

  async createUploadUrl(input: UploadedFileStorageUploadUrlRequest): Promise<UploadedFileStorageUploadTarget> {
    this.uploadRequests.push(input);
    this.contentTypes.set(input.key, input.contentType);
    this.metadata.set(input.key, { ...input.metadata });
    return {
      method: 'PUT',
      url: `https://signed.upload.test/${this.uploadRequests.length}`,
      headers: {
        'content-length': String(input.size),
        'content-type': input.contentType,
        'x-upload-id': input.metadata['upload-id'],
      },
    };
  }

  async headObject(key: string): Promise<UploadedFileStorageObjectMetadata | null> {
    const value = this.objects.get(key);
    return value
      ? {
          size: value.byteLength,
          contentType: this.contentTypes.get(key) ?? null,
          etag: `"etag-${value.byteLength}"`,
          checksum: null,
          metadata: this.metadata.get(key) ?? {},
        }
      : null;
  }

  async promoteObject(input: UploadedFileStoragePromoteRequest): Promise<void> {
    this.promotions.push(input);
    const value = this.objects.get(input.sourceKey);
    if (!value) throw new Error('missing staging object');
    if (!this.objects.has(input.destinationKey)) this.objects.set(input.destinationKey, Buffer.from(value));
    this.contentTypes.set(input.destinationKey, this.contentTypes.get(input.sourceKey) ?? 'application/octet-stream');
    this.metadata.set(input.destinationKey, { ...(this.metadata.get(input.sourceKey) ?? {}) });
  }

  async putObject(key: string, source: UploadedFileStorageSource, options: UploadedFileStorageWriteOptions): Promise<void> {
    if (!(Buffer.isBuffer(source) || source instanceof Uint8Array)) throw new Error('test storage expects buffered source');
    if (this.objects.has(key)) throw new Error('overwrite refused');
    this.objects.set(key, Buffer.from(source));
    this.contentTypes.set(key, options.contentType);
  }

  async write(key: string, buffer: Buffer, options: UploadedFileStorageWriteOptions): Promise<void> {
    await this.putObject(key, buffer, options);
  }

  async download(key: string): Promise<Readable> {
    const value = this.objects.get(key);
    if (!value) throw new Error('missing');
    return Readable.from(value);
  }

  async deleteObject(key: string): Promise<void> {
    await this.delete([key]);
  }

  async delete(keys: readonly string[]): Promise<void> {
    if (this.failDelete) throw new Error('simulated delete outage');
    for (const key of keys) {
      this.deleted.push(key);
      this.objects.delete(key);
    }
  }

  async createDownloadUrl(input: UploadedFileStorageDownloadUrlRequest): Promise<string> {
    this.downloadRequests.push(input);
    return `https://signed.download.test/${this.downloadRequests.length}`;
  }

  resolvePublicUrl(key: string): string {
    return `https://cdn.test/${key}`;
  }

  publicUrl(key: string): string {
    return this.resolvePublicUrl(key);
  }
}

interface DirectServiceSurface {
  initiateUpload(input: InitiateUploadedFileInput): Promise<InitiateUploadedFileResult>;
  initiateTemporaryUpload(input: InitiateUploadedFileInput): Promise<InitiateUploadedFileResult>;
  completeUpload(id: string): Promise<UploadedFileResult>;
  abortUpload(id: string): Promise<void>;
  deleteById(id: string): Promise<void>;
  find(id: string): Promise<UploadedFileResult>;
  resolveUrl(id: string): Promise<{ url: string; urlExpiredAt: Date | null }>;
  cleanupPendingUploads(limit?: number): Promise<number>;
  cleanupExpiredTemporaryFiles(now?: Date, limit?: number): Promise<number>;
  unsafeSystemCleanupCompletedStaging(limit?: number): Promise<number>;
  unsafeSystemPurgeUnusedBefore(cutoff: Date): Promise<number>;
  upload(
    source: Buffer | Uint8Array | Readable,
    originalName: string,
    context: Record<string, string> | undefined,
    ownerId: string | undefined,
    options: Record<string, unknown> | undefined,
  ): Promise<UploadedFileResult>;
  uploadTemporary(
    source: Buffer | Uint8Array | Readable,
    originalName: string,
    context: Record<string, string> | undefined,
    ownerId: string | undefined,
    options: Record<string, unknown> | undefined,
  ): Promise<UploadedFileResult>;
}

describe('UploadedFileService direct-upload lifecycle (pg-mem)', () => {
  let dataSource: DataSource;
  let context: ContextService;
  let storage: DirectMemoryStorage;
  let service: UploadedFileService;
  let direct: DirectServiceSurface;
  let fetchMock: jest.SpiedFunction<typeof fetch>;

  beforeEach(async () => {
    dataSource = await createTestDataSource([UploadedFile]);
    context = new ContextService();
    storage = new DirectMemoryStorage();
    service = new UploadedFileService(
      dataSource.getRepository(UploadedFile),
      storage,
      normalizeUploadedFileConfig({
        driver: 's3',
        bucket: 'test',
        allowedMimeTypes: ['text/plain', 'image/png'],
        allowPublicUploads: true,
        cdnBaseUrl: 'https://cdn.test',
      }),
      context,
    );
    direct = service as unknown as DirectServiceSurface;
    fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const pending = storage.uploadRequests.at(-1);
      if (!pending) throw new Error('missing upload request');
      const body = init?.body;
      if (Buffer.isBuffer(body) || body instanceof Uint8Array) {
        storage.objects.set(pending.key, Buffer.from(body));
      } else if (body instanceof Readable) {
        const chunks: Buffer[] = [];
        for await (const chunk of body) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        storage.objects.set(pending.key, Buffer.concat(chunks));
      } else {
        throw new Error('unexpected test body');
      }
      return { ok: true, status: 200 } as Response;
    });
  });

  afterEach(async () => {
    fetchMock.mockRestore();
    jest.useRealTimers();
    await dataSource.destroy();
  });

  const asOwner = <T>(callback: () => Promise<T>): Promise<T> =>
    context.run({ tenant: 'tenant-a', userId: USER_ID, identitySource: 'verified-principal' }, callback);

  const input = (size = 7): InitiateUploadedFileInput => ({ originalName: '../invoice.txt', contentType: 'text/plain', size });

  it('persists a private pending row before returning one-object upload instructions without storage internals', async () => {
    const initiated = await asOwner(() => direct.initiateUpload(input()));
    const row = await dataSource.getRepository(UploadedFile).findOneByOrFail({ id: initiated.id });

    expect(initiated).toMatchObject({
      id: row.id,
      status: 'pending',
      upload: {
        method: 'PUT',
        url: 'https://signed.upload.test/1',
        headers: { 'content-length': '7', 'content-type': 'text/plain' },
        expiredAt: row.uploadExpiredAt,
      },
    });
    expect(Object.keys(initiated.upload).sort()).toEqual(['expiredAt', 'headers', 'method', 'url']);
    expect(JSON.stringify(initiated)).not.toContain(row.pendingKey);
    expect(JSON.stringify(initiated)).not.toContain(row.key);
    expect(row).toMatchObject({
      fileName: 'invoice.txt',
      sizeBytes: 7,
      contentType: 'text/plain',
      visibility: 'private',
      status: 'pending',
      isTemporary: false,
      completedAt: null,
      expiredAt: null,
      uploadExpiredAt: expect.any(Date),
      uploadPendingAt: expect.any(Date),
    });
    expect(row.pendingKey).toContain('/pending/');
    expect(row.key).toContain('/private/');
    await expect(asOwner(() => direct.find(initiated.id))).resolves.toMatchObject({
      id: initiated.id,
      status: 'pending',
      url: null,
      urlExpiredAt: null,
    });
    expect(storage.downloadRequests).toHaveLength(0);
  });

  it('rejects missing and wrong-sized staging objects before promotion', async () => {
    const missing = await asOwner(() => direct.initiateUpload(input()));
    await expect(asOwner(() => direct.completeUpload(missing.id))).rejects.toMatchObject({ status: 400 });

    const mismatch = await asOwner(() => direct.initiateUpload(input()));
    const row = await dataSource.getRepository(UploadedFile).findOneByOrFail({ id: mismatch.id });
    storage.objects.set(row.pendingKey!, Buffer.from('wrong-size'));
    await expect(asOwner(() => direct.completeUpload(mismatch.id))).rejects.toMatchObject({ status: 400 });
    expect(storage.promotions).toHaveLength(0);
  });

  it('completes idempotently, promotes the verified ETag, and returns a signed private preview URL', async () => {
    const initiated = await asOwner(() => direct.initiateUpload(input()));
    const pending = await dataSource.getRepository(UploadedFile).findOneByOrFail({ id: initiated.id });
    storage.objects.set(pending.pendingKey!, Buffer.from('payload'));

    const first = await asOwner(() => direct.completeUpload(initiated.id));
    const second = await asOwner(() => direct.completeUpload(initiated.id));

    expect(first).toMatchObject({
      id: initiated.id,
      originalName: 'invoice.txt',
      size: 7,
      visibility: 'private',
      status: 'ready',
      isTemporary: false,
      url: 'https://signed.download.test/1',
      urlExpiredAt: expect.any(Date),
    });
    expect(first.urlExpiredAt!.getTime() - Date.now()).toBeGreaterThan(15 * 60 * 1000 - 1000);
    expect(first.urlExpiredAt!.getTime() - Date.now()).toBeLessThanOrEqual(15 * 60 * 1000);
    expect(second.status).toBe('ready');
    expect(storage.promotions).toHaveLength(1);
    expect(storage.promotions[0]).toMatchObject({ sourceEtag: '"etag-7"', visibility: 'private' });
    expect(storage.downloadRequests).toHaveLength(2);
  });

  it('confirms ready state when finalization commits but its database response is lost', async () => {
    const initiated = await asOwner(() => direct.initiateUpload(input()));
    const repository = dataSource.getRepository(UploadedFile);
    const row = await repository.findOneByOrFail({ id: initiated.id });
    storage.objects.set(row.pendingKey!, Buffer.from('payload'));
    const originalUpdate = repository.update.bind(repository);
    let responseLost = false;
    const updateSpy = jest.spyOn(repository, 'update').mockImplementation(async (criteria, partial) => {
      const result = await originalUpdate(criteria, partial);
      if (!responseLost && (partial as { status?: string }).status === 'ready') {
        responseLost = true;
        throw new Error('simulated committed update response loss');
      }
      return result;
    });

    await expect(asOwner(() => direct.completeUpload(initiated.id))).resolves.toMatchObject({ status: 'ready' });
    expect(responseLost).toBe(true);
    expect((await repository.findOneByOrFail({ id: initiated.id })).status).toBe('ready');
    expect(storage.promotions).toHaveLength(1);
    updateSpy.mockRestore();
  });

  it('coalesces concurrent completion and never re-promotes replayed staging bytes over the final object', async () => {
    const initiated = await asOwner(() => direct.initiateUpload(input()));
    const row = await dataSource.getRepository(UploadedFile).findOneByOrFail({ id: initiated.id });
    storage.objects.set(row.pendingKey!, Buffer.from('payload'));

    const [first, second] = await Promise.all([
      asOwner(() => direct.completeUpload(initiated.id)),
      asOwner(() => direct.completeUpload(initiated.id)),
    ]);
    expect(first.status).toBe('ready');
    expect(second.status).toBe('ready');
    expect(storage.promotions).toHaveLength(1);

    storage.objects.set(row.pendingKey!, Buffer.from('changed'));
    await asOwner(() => direct.completeUpload(initiated.id));
    expect(storage.promotions).toHaveLength(1);
    expect(storage.objects.get(row.key)?.toString()).toBe('payload');
  });

  it('does not let abort or delete steal an active completion lease', async () => {
    const initiated = await asOwner(() => direct.initiateUpload(input()));
    const row = await dataSource.getRepository(UploadedFile).findOneByOrFail({ id: initiated.id });
    storage.objects.set(row.pendingKey!, Buffer.from('payload'));
    const originalPromote = storage.promoteObject.bind(storage);
    let entered!: () => void;
    let release!: () => void;
    const promotionEntered = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const promotionRelease = new Promise<void>((resolve) => {
      release = resolve;
    });
    jest.spyOn(storage, 'promoteObject').mockImplementationOnce(async (request) => {
      entered();
      await promotionRelease;
      await originalPromote(request);
    });

    const completion = asOwner(() => direct.completeUpload(initiated.id));
    await promotionEntered;
    await expect(asOwner(() => direct.abortUpload(initiated.id))).rejects.toMatchObject({ status: 400 });
    await expect(asOwner(() => direct.deleteById(initiated.id))).rejects.toMatchObject({ status: 400 });
    expect(storage.deleted).toHaveLength(0);

    release();
    await expect(completion).resolves.toMatchObject({ status: 'ready' });
    expect(storage.promotions).toHaveLength(1);
  });

  it('runs internal S3 upload through initiate, exact signed PUT, and complete', async () => {
    const result = await asOwner(() =>
      direct.upload(Buffer.from('payload'), 'invoice.txt', { module: 'contract', type: 'attachment' }, USER_ID, {
        contentType: 'text/plain',
        visibility: 'private',
        disposition: 'attachment',
      }),
    );

    expect(fetchMock).toHaveBeenCalledWith('https://signed.upload.test/1', {
      method: 'PUT',
      headers: { 'content-length': '7', 'content-type': 'text/plain', 'x-upload-id': result.id },
      body: expect.any(Buffer),
    });
    expect(result).toMatchObject({ status: 'ready', visibility: 'private', url: 'https://signed.download.test/1' });
    expect(storage.promotions).toHaveLength(1);
  });

  it('allows public internal uploads only with opt-in and returns a stable CDN URL without expiry', async () => {
    const result = await asOwner(() =>
      direct.upload(Buffer.from('payload'), 'invoice.txt', { module: 'cms', type: 'cover' }, USER_ID, {
        contentType: 'text/plain',
        visibility: 'public',
        disposition: 'inline',
      }),
    );

    expect(result).toMatchObject({ visibility: 'public', status: 'ready', urlExpiredAt: null });
    expect(result.url).toMatch(/^https:\/\/cdn\.test\/core\/public\//);
    expect(storage.promotions[0]).toMatchObject({ visibility: 'public', publicAccessMode: 'external' });

    const disabled = new UploadedFileService(
      dataSource.getRepository(UploadedFile),
      storage,
      normalizeUploadedFileConfig({ driver: 's3', bucket: 'test', allowedMimeTypes: ['text/plain'] }),
      context,
    ) as unknown as DirectServiceSurface;
    await expect(
      asOwner(() =>
        disabled.upload(Buffer.from('blocked'), 'blocked.txt', undefined, USER_ID, {
          contentType: 'text/plain',
          visibility: 'public',
        }),
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('makes temporary files private for exactly 24 hours and clamps the last signed URL to expiry', async () => {
    const completedAt = new Date('2026-08-03T00:00:00.000Z');
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    jest.setSystemTime(completedAt);

    const result = await asOwner(() =>
      direct.uploadTemporary(Buffer.from('payload'), 'temporary.txt', { module: 'preview' }, USER_ID, { contentType: 'text/plain' }),
    );
    expect(result).toMatchObject({ visibility: 'private', isTemporary: true, completedAt, urlExpiredAt: expect.any(Date) });
    expect(result.expiredAt?.getTime()).toBe(completedAt.getTime() + 24 * 60 * 60 * 1000);

    jest.setSystemTime(new Date(result.expiredAt!.getTime() - 1000));
    await expect(direct.unsafeSystemPurgeUnusedBefore(new Date(Date.now() + 1))).resolves.toBe(0);
    await expect(asOwner(() => direct.resolveUrl(result.id))).resolves.toMatchObject({
      url: expect.stringContaining('signed.download.test'),
      urlExpiredAt: result.expiredAt,
    });
    expect(storage.downloadRequests.at(-1)?.expiresInSeconds).toBe(1);

    const signedCount = storage.downloadRequests.length;
    jest.setSystemTime(new Date(result.expiredAt!.getTime() - 1));
    await expect(asOwner(() => direct.resolveUrl(result.id))).resolves.toEqual({
      url: `uploaded-file/${result.id}/download`,
      urlExpiredAt: result.expiredAt,
    });
    expect(storage.downloadRequests).toHaveLength(signedCount);

    jest.setSystemTime(result.expiredAt!);
    await expect(asOwner(() => direct.resolveUrl(result.id))).rejects.toMatchObject({ status: 410 });
    expect(storage.downloadRequests).toHaveLength(signedCount);
  });

  it('rejects Readable internal uploads without a known exact size', async () => {
    await expect(
      asOwner(() => direct.upload(Readable.from('payload'), 'stream.txt', undefined, USER_ID, { contentType: 'text/plain' })),
    ).rejects.toMatchObject({ status: 400 });
    expect(storage.uploadRequests).toHaveLength(0);
  });

  it('streams a Readable with its exact signed content length without buffering it first', async () => {
    const result = await asOwner(() =>
      direct.upload(Readable.from('payload'), 'stream.txt', undefined, USER_ID, { contentType: 'text/plain', size: 7 }),
    );

    expect(fetchMock).toHaveBeenCalledWith('https://signed.upload.test/1', {
      method: 'PUT',
      headers: { 'content-length': '7', 'content-type': 'text/plain', 'x-upload-id': result.id },
      body: expect.any(Readable),
      duplex: 'half',
    });
    expect(result).toMatchObject({ status: 'ready', size: 7 });
  });

  it('best-effort abort never masks the original signed PUT failure', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503 } as Response);
    storage.failDelete = true;

    await expect(
      asOwner(() => direct.upload(Buffer.from('payload'), 'failed.txt', undefined, USER_ID, { contentType: 'text/plain' })),
    ).rejects.toThrow('Signed upload returned HTTP 503');

    const failed = await dataSource.getRepository(UploadedFile).findOne({ where: { fileName: 'failed.txt' }, withDeleted: true });
    expect(failed?.status).toBe('failed');
    expect(failed?.deletionPendingAt).toBeInstanceOf(Date);
  });

  it('rejects malformed direct and managed contracts while keeping canonical aliases operational', async () => {
    const unsafe = service as unknown as {
      initiateUpload(input: Record<string, unknown>): Promise<unknown>;
    };
    await expect(asOwner(() => unsafe.initiateUpload({ ...input(), size: 0 }))).rejects.toMatchObject({ status: 400 });
    await expect(asOwner(() => unsafe.initiateUpload({ ...input(), checksum: 42 }))).rejects.toMatchObject({ status: 400 });
    await expect(asOwner(() => unsafe.initiateUpload({ ...input(), checksum: 'bad\u0000checksum' }))).rejects.toMatchObject({
      status: 400,
    });

    await expect(
      asOwner(() =>
        direct.upload(Buffer.from('payload'), 'invalid.txt', undefined, USER_ID, {
          contentType: 'text/plain',
          visibility: 'invalid',
        }),
      ),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      asOwner(() =>
        direct.upload(Buffer.from('payload'), 'invalid.txt', undefined, USER_ID, {
          contentType: 'text/plain',
          disposition: 'invalid',
        }),
      ),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      asOwner(() =>
        direct.upload(Buffer.from('payload'), 'invalid.txt', undefined, USER_ID, {
          contentType: 'text/plain',
          maxFileSizeBytes: 0,
        }),
      ),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      asOwner(() =>
        direct.upload(Buffer.from('payload'), 'invalid.txt', undefined, USER_ID, {
          contentType: 'text/plain',
          size: 8,
        }),
      ),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      asOwner(() =>
        direct.uploadTemporary(Buffer.from('payload'), 'invalid.txt', undefined, USER_ID, {
          contentType: 'text/plain',
          visibility: 'public',
        }),
      ),
    ).rejects.toMatchObject({ status: 400 });

    await expect(asOwner(() => service.initiate(input()))).resolves.toMatchObject({ status: 'pending' });
    await expect(asOwner(() => service.initiateTemporary(input()))).resolves.toMatchObject({ status: 'pending' });
  });

  it('durably retires a pending row when upload-target creation fails', async () => {
    jest.spyOn(storage, 'createUploadUrl').mockRejectedValueOnce(new Error('private signing detail'));

    await expect(asOwner(() => direct.initiateUpload(input()))).rejects.toMatchObject({ status: 400 });

    const failed = await dataSource.getRepository(UploadedFile).findOne({ where: { fileName: 'invoice.txt' }, withDeleted: true });
    expect(failed).toMatchObject({ status: 'pending', uploadPendingAt: null, deletionPendingAt: null });
    expect(failed?.deletedAt).toBeInstanceOf(Date);
    expect(storage.deleted).toEqual(expect.arrayContaining([failed!.key, failed!.pendingKey!]));
  });

  it('covers canonical aliases, reference reconciliation, id deletion, and permanent age cleanup', async () => {
    const pending = await asOwner(() => service.initiate(input()));
    await expect(asOwner(() => service.abort(pending.id))).resolves.toBeUndefined();

    const ready = await asOwner(() =>
      direct.upload(Buffer.from('payload'), 'ready.txt', undefined, USER_ID, { contentType: 'text/plain' }),
    );
    await expect(asOwner(() => service.find(ready.id))).resolves.toMatchObject({ id: ready.id, status: 'ready' });
    await expect(asOwner(() => service.complete(ready.id))).resolves.toMatchObject({ id: ready.id, status: 'ready' });

    await expect(asOwner(() => service.useFiles([]))).resolves.toBeUndefined();
    await expect(asOwner(() => service.useFiles([ready.key], 'invoice', ENTITY_ID))).resolves.toBeUndefined();
    await expect(asOwner(() => service.changeFiles([ready.key], [ready.key], 'invoice', ENTITY_ID))).resolves.toBeUndefined();
    expect(await dataSource.getRepository(UploadedFile).findOneByOrFail({ id: ready.id })).toMatchObject({
      isUsed: true,
      entity: 'invoice',
      entityId: ENTITY_ID,
    });

    await expect(asOwner(() => direct.deleteById(ready.id))).resolves.toBeUndefined();
    expect(await dataSource.getRepository(UploadedFile).findOne({ where: { id: ready.id }, withDeleted: true })).toMatchObject({
      deletedAt: expect.any(Date),
    });

    const unused = await asOwner(() =>
      direct.upload(Buffer.from('payload'), 'unused.txt', undefined, USER_ID, { contentType: 'text/plain' }),
    );
    await expect(service.unsafeSystemPurgeUnusedBefore(new Date(Date.now() + 1))).resolves.toBe(1);
    expect(await dataSource.getRepository(UploadedFile).findOne({ where: { id: unused.id }, withDeleted: true })).toMatchObject({
      deletedAt: expect.any(Date),
    });
    await expect(service.cleanupPending()).resolves.toBe(0);
    await expect(service.cleanupExpiredTemporary()).resolves.toBe(0);
  });

  it('normalizes private URL, byte-download, and attached-policy failures to non-enumerating responses', async () => {
    const ready = await asOwner(() =>
      direct.upload(Buffer.from('payload'), 'private.txt', undefined, USER_ID, { contentType: 'text/plain' }),
    );

    jest.spyOn(storage, 'createDownloadUrl').mockRejectedValueOnce(new Error('private signing detail'));
    await expect(asOwner(() => service.find(ready.id))).rejects.toMatchObject({ status: 404 });

    storage.objects.delete(ready.key);
    await expect(asOwner(() => service.download(ready.id))).rejects.toMatchObject({ status: 404 });

    const attachedService = new UploadedFileService(
      dataSource.getRepository(UploadedFile),
      storage,
      normalizeUploadedFileConfig({
        driver: 's3',
        bucket: 'test',
        allowedMimeTypes: ['text/plain'],
        attachedReadPolicy: async () => {
          throw new Error('private policy detail');
        },
      }),
      context,
    );
    await expect(
      asOwner(() => attachedService.downloadAttached(ready.id, { module: 'billing', entity: 'invoice', entityId: ENTITY_ID })),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      asOwner(() => attachedService.downloadAttached(ready.id, { module: '', entity: 'invoice', entityId: ENTITY_ID })),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('cleans retained staging independently without deleting the promoted final object', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    jest.setSystemTime(new Date('2026-08-03T00:00:00.000Z'));
    const result = await asOwner(() =>
      direct.upload(Buffer.from('payload'), 'staged.txt', undefined, USER_ID, { contentType: 'text/plain' }),
    );
    const row = await dataSource.getRepository(UploadedFile).findOneByOrFail({ id: result.id });
    const stagingKey = row.pendingKey!;
    expect(storage.objects.has(stagingKey)).toBe(true);
    expect(storage.objects.has(row.key)).toBe(true);

    jest.setSystemTime(row.uploadExpiredAt!);
    await expect(direct.unsafeSystemCleanupCompletedStaging()).resolves.toBe(1);

    const cleaned = await dataSource.getRepository(UploadedFile).findOneByOrFail({ id: row.id });
    expect(cleaned.pendingKey).toBeNull();
    expect(storage.objects.has(stagingKey)).toBe(false);
    expect(storage.objects.has(row.key)).toBe(true);
  });

  it('claims expired temporary cleanup before I/O and retries a failed delete through the outbox', async () => {
    const completedAt = new Date('2026-08-03T00:00:00.000Z');
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    jest.setSystemTime(completedAt);
    const result = await asOwner(() =>
      direct.uploadTemporary(Buffer.from('payload'), 'expiring.txt', undefined, USER_ID, { contentType: 'text/plain' }),
    );
    storage.failDelete = true;
    jest.setSystemTime(result.expiredAt!);

    await expect(direct.cleanupExpiredTemporaryFiles()).resolves.toBe(0);
    const pending = await dataSource.getRepository(UploadedFile).findOneByOrFail({ id: result.id });
    expect(pending.deletionPendingAt).toBeInstanceOf(Date);
    await expect(asOwner(() => direct.resolveUrl(result.id))).rejects.toMatchObject({ status: 404 });

    storage.failDelete = false;
    await dataSource
      .getRepository(UploadedFile)
      .update({ id: result.id, deletionPendingAt: pending.deletionPendingAt! }, { deletionPendingAt: new Date(Date.now() - 1) });
    await expect(direct.cleanupPendingUploads()).resolves.toBeGreaterThanOrEqual(1);
    const deleted = await dataSource.getRepository(UploadedFile).findOne({ where: { id: result.id }, withDeleted: true });
    expect(deleted?.deletedAt).toBeInstanceOf(Date);
    expect(storage.objects.has(pending.key)).toBe(false);
  });

  it('retires an expired uncompleted direct upload after its in-flight safety lease', async () => {
    const startedAt = new Date('2026-08-03T00:00:00.000Z');
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    jest.setSystemTime(startedAt);
    const initiated = await asOwner(() => direct.initiateUpload(input()));
    const row = await dataSource.getRepository(UploadedFile).findOneByOrFail({ id: initiated.id });
    storage.objects.set(row.pendingKey!, Buffer.from('payload'));

    jest.setSystemTime(row.uploadPendingAt!);
    await expect(direct.cleanupPendingUploads()).resolves.toBeGreaterThanOrEqual(1);

    const retired = await dataSource.getRepository(UploadedFile).findOne({ where: { id: row.id }, withDeleted: true });
    expect(retired?.status).toBe('failed');
    expect(retired?.deletedAt).toBeInstanceOf(Date);
    expect(storage.objects.has(row.pendingKey!)).toBe(false);
  });

  it('keeps the same provider-neutral lifecycle for the protected local upload target', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sdcore-direct-local-'));
    try {
      const localConfig = normalizeUploadedFileConfig({
        driver: 'local',
        localRoot: root,
        host: 'https://api.test',
        allowedMimeTypes: ['text/plain'],
      });
      const localStorage = new LocalUploadedFileStorage(localConfig);
      const localService = new UploadedFileService(dataSource.getRepository(UploadedFile), localStorage, localConfig, context);
      const local = localService as unknown as DirectServiceSurface;

      const initiated = await asOwner(() => local.initiateUpload(input()));
      expect(initiated.upload).toMatchObject({
        method: 'PUT',
        url: `https://api.test/uploaded-file/${initiated.id}/content`,
        headers: { 'content-length': '7', 'content-type': 'application/octet-stream' },
      });

      const result = await asOwner(() =>
        local.upload(Buffer.from('payload'), 'local.txt', undefined, USER_ID, { contentType: 'text/plain', visibility: 'private' }),
      );
      expect(result).toMatchObject({
        status: 'ready',
        visibility: 'private',
        url: `https://api.test/uploaded-file/${result.id}/download`,
        urlExpiredAt: null,
      });
      const row = await dataSource.getRepository(UploadedFile).findOneByOrFail({ id: result.id });
      expect(row.pendingKey).toBeNull();
      await expect(localStorage.download(row.key)).resolves.toBeInstanceOf(Readable);

      const streamed = await asOwner(() =>
        local.upload(Readable.from('stream'), 'stream.txt', undefined, USER_ID, {
          contentType: 'text/plain',
          size: 6,
          visibility: 'private',
        }),
      );
      expect(streamed).toMatchObject({ status: 'ready', size: 6, visibility: 'private' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('recovers a local promote that created the final path before staging unlink failed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sdcore-direct-local-recovery-'));
    try {
      const localConfig = normalizeUploadedFileConfig({
        driver: 'local',
        localRoot: root,
        host: 'https://api.test',
        allowedMimeTypes: ['text/plain'],
      });
      const localStorage = new LocalUploadedFileStorage(localConfig);
      const localService = new UploadedFileService(dataSource.getRepository(UploadedFile), localStorage, localConfig, context);
      const local = localService as unknown as DirectServiceSurface;
      const initiated = await asOwner(() => local.initiateUpload(input()));
      const pending = await dataSource.getRepository(UploadedFile).findOneByOrFail({ id: initiated.id });
      const originalPromote = localStorage.promoteObject.bind(localStorage);
      jest
        .spyOn(localStorage, 'promoteObject')
        .mockImplementationOnce(async ({ destinationKey }) => {
          await localStorage.putObject(destinationKey, Buffer.from('payload'), {
            contentType: 'text/plain',
            contentDisposition: 'attachment',
          });
          throw new Error('simulated unlink failure after final creation');
        })
        .mockImplementation(originalPromote);

      await expect(asOwner(() => localService.putUploadContent(initiated.id, Buffer.from('payload')))).rejects.toMatchObject({
        status: 400,
      });
      await expect(localStorage.headObject(pending.pendingKey!)).resolves.not.toBeNull();
      await expect(localStorage.headObject(pending.key)).resolves.not.toBeNull();

      await expect(asOwner(() => local.completeUpload(initiated.id))).resolves.toMatchObject({ status: 'ready' });
      await expect(localStorage.headObject(pending.pendingKey!)).resolves.toBeNull();
      expect((await dataSource.getRepository(UploadedFile).findOneByOrFail({ id: initiated.id })).pendingKey).toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
