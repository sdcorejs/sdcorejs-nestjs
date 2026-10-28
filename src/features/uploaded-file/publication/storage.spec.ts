import { createHash } from 'node:crypto';
import { createUploadedFilePublicationCoordinator } from './coordinator';
import { createUploadedFilePublicationStorage } from './storage';
import type { UploadedFilePublicationIntent as Intent, UploadedFilePublicationObjectMetadata as Metadata } from './types';

async function setup() {
  const bytes = Buffer.from('synthetic-publication-bytes');
  const source = {
    id: 'source',
    version: 'v1',
    locator: 'private/exact-source',
    sha256: createHash('sha256').update(bytes).digest('hex'),
    size: bytes.length,
    contentType: 'image/png',
  };
  let intent!: Intent;
  const coordinator = createUploadedFilePublicationCoordinator({
    config: {
      environment: 'dev',
      keyPrefix: '',
      modulePrefixes: { asset: 'app-assets' },
      cdnBaseUrl: 'https://cdn.example.test',
      deliveryMode: 'external',
    },
    policy: {
      resolve: async () => ({
        visibility: 'public',
        binding: { environment: 'dev', module: 'asset', scopeId: 'scope', bindingId: 'logo', generation: 'v1' },
        source,
      }),
    },
    repository: {
      stage: async (_tx, value) => {
        intent = value;
        return value;
      },
      retire: async () => undefined,
      retireLogicalBinding: async () => undefined,
      claim: async () => null,
      isCurrent: async () => false,
      commitReady: async () => 'lost',
      record: async () => false,
      readCurrent: async () => null,
    },
    storage: { inspect: async () => 'absent', publish: async () => 'unknown', removeExact: async () => 'unknown' },
  });
  await coordinator.stage(undefined, undefined);
  const objects = new Map<string, Metadata>();
  const readSource = jest.fn(async () => ({ bytes, version: 'v1' }));
  const port = {
    headExact: jest.fn(async (key: string) => objects.get(key) ?? (null as Metadata | null | 'unknown')),
    putImmutable: jest.fn(async (key: string, _bytes: Uint8Array, metadata: Metadata) => {
      if (objects.has(key)) return 'conflict' as const;
      objects.set(key, { ...metadata });
      return 'acknowledged' as 'acknowledged' | 'unknown' | 'conflict';
    }),
    deleteExact: jest.fn(async (key: string, hash: string) => {
      if (objects.get(key)?.descriptorHash !== hash) return 'conflict' as const;
      objects.delete(key);
      return 'acknowledged' as 'acknowledged' | 'unknown' | 'conflict';
    }),
  };
  const storage = createUploadedFilePublicationStorage({
    readSource,
    objects: port,
    deliveryProfile: { id: 'requested-config-v1', cdnBaseUrl: 'https://cdn.example.test', mode: 'external' },
  });
  return { bytes, source, intent, objects, readSource, port, storage, signal: new AbortController().signal };
}
describe('shared rendition byte/object protocol', () => {
  it('writes verified bytes and metadata, then requires matching HEAD', async () => {
    const s = await setup();
    expect(await s.storage.publish(s.intent, s.signal)).toBe('acknowledged');
    expect(s.port.putImmutable).toHaveBeenCalledTimes(1);
    const meta = s.objects.get(s.intent.target.key)!;
    expect(meta).toEqual({
      descriptorHash: s.intent.descriptorHash,
      sha256: s.source.sha256,
      sourceVersion: 'v1',
      size: s.bytes.length,
      contentType: 'image/png',
      deliveryProfileId: 'requested-config-v1',
    });
    expect(await s.storage.inspect(s.intent, s.signal)).toBe('matching');
  });
  it('reuses matching immutable object without reading or putting source again', async () => {
    const s = await setup();
    await s.storage.publish(s.intent, s.signal);
    s.readSource.mockClear();
    s.port.putImmutable.mockClear();
    expect(await s.storage.publish(s.intent, s.signal)).toBe('acknowledged');
    expect(s.readSource).not.toHaveBeenCalled();
    expect(s.port.putImmutable).not.toHaveBeenCalled();
  });
  it.each(['digest', 'version', 'size'] as const)('rejects wrong source %s before PUT', async (kind) => {
    const s = await setup();
    s.readSource.mockResolvedValue(
      kind === 'digest'
        ? { bytes: Buffer.alloc(s.bytes.length), version: 'v1' }
        : kind === 'version'
          ? { bytes: s.bytes, version: 'v2' }
          : { bytes: s.bytes.subarray(1), version: 'v1' },
    );
    await expect(s.storage.publish(s.intent, s.signal)).rejects.toHaveProperty('code', 'core.file.publication.source-integrity');
    expect(s.port.putImmutable).not.toHaveBeenCalled();
  });
  it('unknown HEAD does not trigger source read/PUT', async () => {
    const s = await setup();
    s.port.headExact.mockResolvedValue('unknown');
    expect(await s.storage.publish(s.intent, s.signal)).toBe('unknown');
    expect(s.readSource).not.toHaveBeenCalled();
    expect(s.port.putImmutable).not.toHaveBeenCalled();
  });
  it('lost PUT acknowledgement remains unknown and later HEAD reconciles', async () => {
    const s = await setup();
    s.port.putImmutable.mockImplementation(async (key, _bytes, meta) => {
      s.objects.set(key, meta);
      return 'unknown';
    });
    expect(await s.storage.publish(s.intent, s.signal)).toBe('unknown');
    expect(await s.storage.inspect(s.intent, s.signal)).toBe('matching');
  });
  it('rejects a target outside the explicitly configured CDN base', async () => {
    const s = await setup();
    await expect(
      s.storage.publish({ ...s.intent, target: { ...s.intent.target, url: 'https://evil.example/file' } }, s.signal),
    ).rejects.toHaveProperty('code', 'core.file.publication.invalid-descriptor');
    expect(s.port.putImmutable).not.toHaveBeenCalled();
  });
  it('never deletes foreign metadata', async () => {
    const s = await setup();
    await s.storage.publish(s.intent, s.signal);
    s.objects.get(s.intent.target.key)!.descriptorHash = '0'.repeat(64);
    expect(await s.storage.inspect(s.intent, s.signal)).toBe('conflict');
    expect(await s.storage.removeExact(s.intent, s.signal)).toBe('unknown');
    expect(s.port.deleteExact).not.toHaveBeenCalled();
  });
  it('conditional delete conflict is unknown, not retired', async () => {
    const s = await setup();
    await s.storage.publish(s.intent, s.signal);
    s.port.deleteExact.mockResolvedValue('conflict');
    expect(await s.storage.removeExact(s.intent, s.signal)).toBe('unknown');
    expect(s.objects.size).toBe(1);
  });
  it('does not report deletion acknowledgement until HEAD confirms absence', async () => {
    const s = await setup();
    await s.storage.publish(s.intent, s.signal);
    s.port.deleteExact.mockResolvedValue('acknowledged');
    expect(await s.storage.removeExact(s.intent, s.signal)).toBe('unknown');
    expect(s.objects.size).toBe(1);
  });
  it('removes only exact public rendition; never asks readSource to delete', async () => {
    const s = await setup();
    await s.storage.publish(s.intent, s.signal);
    s.readSource.mockClear();
    expect(await s.storage.removeExact(s.intent, s.signal)).toBe('acknowledged');
    expect(s.port.deleteExact).toHaveBeenCalledWith(s.intent.target.key, s.intent.descriptorHash, s.signal);
    expect(s.readSource).not.toHaveBeenCalled();
    expect(s.objects.size).toBe(0);
  });
  it('respects an already aborted operation without object or source access', async () => {
    const s = await setup();
    const c = new AbortController();
    c.abort();
    expect(await s.storage.publish(s.intent, c.signal)).toBe('unknown');
    expect(await s.storage.removeExact(s.intent, c.signal)).toBe('unknown');
    expect(s.readSource).not.toHaveBeenCalled();
    expect(s.port.headExact).not.toHaveBeenCalled();
  });
  it('requires explicit external delivery configuration and bounded sizes', () => {
    const objects = {
      headExact: async () => null,
      putImmutable: async () => 'unknown' as const,
      deleteExact: async () => 'unknown' as const,
    };
    const readSource = async () => ({ bytes: new Uint8Array(), version: 'v1' });
    expect(() =>
      createUploadedFilePublicationStorage({
        objects,
        readSource,
        deliveryProfile: { id: 'config', cdnBaseUrl: 'http://cdn.example.test', mode: 'external' },
      }),
    ).toThrow();
    expect(() =>
      createUploadedFilePublicationStorage({
        objects,
        readSource,
        maxBytes: 0,
        deliveryProfile: { id: 'config', cdnBaseUrl: 'https://cdn.example.test', mode: 'external' },
      }),
    ).toThrow();
  });
});
