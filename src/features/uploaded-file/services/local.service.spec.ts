import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { normalizeUploadedFileConfig } from '../config';
import { LocalUploadedFileStorage } from './local.service';

const writeOptions = { contentType: 'text/plain', contentDisposition: 'attachment' };

async function text(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

describe('LocalUploadedFileStorage', () => {
  let root: string;
  let storage: LocalUploadedFileStorage;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'sdcore-local-storage-'));
    storage = new LocalUploadedFileStorage(normalizeUploadedFileConfig({ localRoot: root, host: 'https://api.test/' }));
  });

  afterEach(async () => rm(root, { recursive: true, force: true }));

  it('writes asynchronously, streams exact content, and refuses overwrite', async () => {
    const key = 'core/tenant/dGVuYW50/file-id/a.txt';
    await storage.write(key, Buffer.from('first'), writeOptions);
    await expect(storage.write(key, Buffer.from('second'), writeOptions)).rejects.toMatchObject({ code: 'EEXIST' });
    await expect(text(await storage.download(key))).resolves.toBe('first');
  });

  it('supports concurrent writes that create the same previously-missing prefix', async () => {
    const keys = Array.from({ length: 20 }, (_, index) => `core/tenant/shared-prefix/file-${index}.txt`);

    await Promise.all(keys.map((key, index) => storage.write(key, Buffer.from(String(index)), writeOptions)));

    await expect(Promise.all(keys.map(async (key) => text(await storage.download(key))))).resolves.toEqual(
      keys.map((_, index) => String(index)),
    );
  });

  it('deletes only the exact requested object', async () => {
    const first = 'core/tenant/dGVuYW50/first/a.txt';
    const second = 'core/tenant/dGVuYW50/second/a.txt';
    await storage.write(first, Buffer.from('first'), writeOptions);
    await storage.write(second, Buffer.from('second'), writeOptions);
    await storage.delete([first]);
    await expect(storage.download(first)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(text(await storage.download(second))).resolves.toBe('second');
  });

  it.each(['../outside', 'core/../../outside', '/absolute', 'C:\\absolute', 'core/%2e%2e/outside'])(
    'applies containment to write, read, and delete for %s',
    async (key) => {
      await expect(storage.write(key, Buffer.from('x'), writeOptions)).rejects.toThrow('storage key');
      await expect(storage.download(key)).rejects.toThrow('storage key');
      await expect(storage.delete([key])).rejects.toThrow('storage key');
    },
  );

  it('builds a public URL from the object key without exposing the filesystem root', () => {
    const url = storage.publicUrl('core/tenant/t/id/a.txt');
    expect(url).toBe('https://api.test/file-storage/core/tenant/t/id/a.txt');
    expect(url).not.toContain(root);
  });
});
