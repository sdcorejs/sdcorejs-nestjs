import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SafeLocalPathResolver } from './local-path';
import { isPublicNetworkAddress, secureFetchRemote } from './remote-fetcher';
import { buildStorageKey, DEFAULT_ALLOWED_MIME_TYPES, normalizeStoragePrefix, validateUploadBuffer } from './upload-security';

function buildStoredOoxml(mainPart: string): Buffer {
  const entries = [
    { name: '[Content_Types].xml', data: Buffer.from('<Types/>') },
    { name: mainPart, data: Buffer.from('<root/>') },
  ];
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(entry.data.byteLength, 18);
    local.writeUInt32LE(entry.data.byteLength, 22);
    local.writeUInt16LE(name.byteLength, 26);
    localParts.push(local, name, entry.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(entry.data.byteLength, 20);
    central.writeUInt32LE(entry.data.byteLength, 24);
    central.writeUInt16LE(name.byteLength, 28);
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(central, name);
    localOffset += local.byteLength + name.byteLength + entry.data.byteLength;
  }

  const local = Buffer.concat(localParts);
  const central = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.byteLength, 12);
  end.writeUInt32LE(local.byteLength, 16);
  return Buffer.concat([local, central, end]);
}

describe('uploaded-file security primitives', () => {
  describe('storage keys', () => {
    it('creates immutable tenant-namespaced UUID keys without reusing the original name', () => {
      const first = buildStorageKey('core', 'tenant-a', 'invoice.pdf');
      const second = buildStorageKey('core', 'tenant-a', 'invoice.pdf');
      const otherTenant = buildStorageKey('core', 'tenant-b', 'invoice.pdf');

      expect(first.key).toMatch(/^core\/tenant\/[A-Za-z0-9_-]+\/[0-9a-f-]{36}\/invoice\.pdf$/);
      expect(first.key).not.toBe(second.key);
      expect(first.key).not.toBe(otherTenant.key);
      expect(first.originalName).toBe('invoice.pdf');
    });

    it('rejects prefixes whose normalized segments would be empty', () => {
      expect(() => normalizeStoragePrefix('core/$$$')).toThrow('prefix');
    });
  });

  describe('upload validation', () => {
    it('accepts a matching PNG signature and rejects MIME/signature mismatches', () => {
      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
      expect(validateUploadBuffer(png, 'image.png', 'image/png', ['image/png'], true).contentType).toBe('image/png');
      expect(() => validateUploadBuffer(png, 'image.pdf', 'application/pdf', ['application/pdf'], true)).toThrow('signature');
    });

    it('rejects buffers above the configured hard limit', () => {
      expect(() => validateUploadBuffer(Buffer.alloc(5), 'a.txt', 'text/plain', ['text/plain'], true, 4)).toThrow('size');
    });

    it('rejects unknown extensions even when their bytes could pass text validation', () => {
      expect(() =>
        validateUploadBuffer(Buffer.from('<html>safe-looking text</html>'), 'page.html', 'text/plain', ['text/plain'], true),
      ).toThrow('extension');
      expect(() => validateUploadBuffer(Buffer.from('plain'), 'extensionless', 'text/plain', ['text/plain'], true)).toThrow('extension');
    });

    it('accepts structurally valid OOXML and rejects a generic ZIP with an Office MIME', () => {
      const mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      expect(DEFAULT_ALLOWED_MIME_TYPES).toContain(mime);
      expect(validateUploadBuffer(buildStoredOoxml('word/document.xml'), 'document.docx', mime, [mime], true).contentType).toBe(mime);
      expect(() => validateUploadBuffer(buildStoredOoxml('custom/not-word.xml'), 'document.docx', mime, [mime], true)).toThrow('signature');
    });
  });

  describe('local path containment', () => {
    let root: string;
    let outside: string;

    beforeEach(async () => {
      root = await mkdtemp(join(tmpdir(), 'sdcore-upload-root-'));
      outside = await mkdtemp(join(tmpdir(), 'sdcore-upload-outside-'));
    });

    afterEach(async () => {
      await Promise.all([rm(root, { recursive: true, force: true }), rm(outside, { recursive: true, force: true })]);
    });

    it.each(['../secret', '..\\secret', '/absolute', 'C:\\absolute', '\\\\server\\share', 'core/../../secret', 'core/%2e%2e/secret'])(
      'rejects unsafe key %s',
      async (key) => {
        const paths = new SafeLocalPathResolver(root);
        await expect(paths.resolveForWrite(key)).rejects.toThrow('storage key');
      },
    );

    it('keeps writes inside the canonical root and rejects symlink escapes', async () => {
      const paths = new SafeLocalPathResolver(root);
      const target = await paths.resolveForWrite('core/tenant/t/file/a.txt');
      expect(target.startsWith(await realpath(root))).toBe(true);
      await writeFile(target, 'safe');

      await mkdir(join(root, 'links'), { recursive: true });
      try {
        await symlink(outside, join(root, 'links', 'outside'), 'junction');
        await expect(paths.resolveForWrite('links/outside/secret.txt')).rejects.toThrow('storage root');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error;
      }
    });
  });

  describe('remote clone SSRF defenses', () => {
    it.each([
      '0.0.0.0',
      '127.0.0.1',
      '10.0.0.1',
      '172.16.0.1',
      '192.168.0.1',
      '169.254.169.254',
      '224.0.0.1',
      '::',
      '::1',
      'fc00::1',
      'fe80::1',
      'ff00::1',
    ])('rejects non-public address %s', (address) => expect(isPublicNetworkAddress(address)).toBe(false));

    it('allows HTTP(S) only and rejects credential-bearing URLs before transport', async () => {
      const lookup = jest.fn(async () => [{ address: '93.184.216.34', family: 4 as const }]);
      const request = jest.fn();
      await expect(secureFetchRemote('file:///etc/passwd', { enabled: true }, { lookup, request })).rejects.toThrow(
        'Remote file fetch failed',
      );
      await expect(secureFetchRemote('https://user:password@public.test/file', { enabled: true }, { lookup, request })).rejects.toThrow(
        'Remote file fetch failed',
      );
      expect(request).not.toHaveBeenCalled();
    });

    it('rejects mixed public/private DNS answers and pins the validated address without identity headers', async () => {
      const mixedLookup = jest.fn(async () => [
        { address: '93.184.216.34', family: 4 as const },
        { address: '127.0.0.1', family: 4 as const },
      ]);
      const request = jest.fn();
      await expect(secureFetchRemote('https://public.test/file', { enabled: true }, { lookup: mixedLookup, request })).rejects.toThrow(
        'Remote file fetch failed',
      );
      expect(request).not.toHaveBeenCalled();

      const lookup = jest.fn(async () => [{ address: '93.184.216.34', family: 4 as const }]);
      const successful = jest.fn(async () => ({ status: 200, headers: {}, data: Buffer.from('ok') }));
      await secureFetchRemote('https://public.test/file', { enabled: true }, { lookup, request: successful });
      expect(successful).toHaveBeenCalledWith(
        expect.objectContaining({
          address: { address: '93.184.216.34', family: 4 },
          headers: { accept: 'application/octet-stream' },
        }),
      );
      const headers = successful.mock.calls[0][0].headers as Record<string, string>;
      expect(headers).not.toHaveProperty('authorization');
      expect(headers).not.toHaveProperty('x-tenant');
      expect(headers).not.toHaveProperty('x-user-id');
    });

    it('revalidates redirect targets and never contacts a private redirect destination', async () => {
      const request = jest.fn(async ({ url }: { url: URL }) => ({
        status: 302,
        headers: { location: url.hostname === 'public.test' ? 'http://internal.test/secret' : undefined },
        data: Buffer.alloc(0),
      }));
      const lookup = jest.fn(async (host: string) =>
        host === 'public.test' ? [{ address: '93.184.216.34', family: 4 as const }] : [{ address: '127.0.0.1', family: 4 as const }],
      );

      await expect(secureFetchRemote('https://public.test/file', { enabled: true, maxRedirects: 2 }, { lookup, request })).rejects.toThrow(
        'Remote file fetch failed',
      );
      expect(request).toHaveBeenCalledTimes(1);
    });

    it('rejects oversized and timed-out remote responses with bounded, generic errors', async () => {
      const lookup = jest.fn(async () => [{ address: '93.184.216.34', family: 4 as const }]);
      const oversized = jest.fn(async () => ({ status: 200, headers: {}, data: Buffer.alloc(5) }));
      await expect(
        secureFetchRemote('https://public.test/file', { enabled: true, maxBytes: 4 }, { lookup, request: oversized }),
      ).rejects.toThrow('Remote file fetch failed');

      const timedOut = jest.fn(async () => {
        throw Object.assign(new Error('socket details must remain private'), { code: 'ECONNABORTED' });
      });
      await expect(
        secureFetchRemote('https://public.test/file', { enabled: true, timeoutMs: 1 }, { lookup, request: timedOut }),
      ).rejects.toThrow(/^Remote file fetch failed$/);
    });

    it('caps even explicitly configured remote fetch sizes at the absolute ceiling', async () => {
      const lookup = jest.fn(async () => [{ address: '93.184.216.34', family: 4 as const }]);
      const request = jest.fn(async () => ({ status: 200, headers: {}, data: Buffer.from('ok') }));

      await secureFetchRemote('https://public.test/file', { enabled: true, maxBytes: Number.MAX_SAFE_INTEGER }, { lookup, request });

      expect(request).toHaveBeenCalledWith(expect.objectContaining({ maxBytes: 25 * 1024 * 1024 }));
    });

    it('falls back to finite timeout and response limits when numeric config is invalid', async () => {
      const lookup = jest.fn(async () => [{ address: '93.184.216.34', family: 4 as const }]);
      const request = jest.fn(async () => ({ status: 200, headers: {}, data: Buffer.from('ok') }));

      await secureFetchRemote(
        'https://public.test/file',
        { enabled: true, timeoutMs: Number.NaN, maxBytes: Number.NaN, maxRedirects: Number.NaN },
        { lookup, request },
      );

      expect(request).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 5_000, maxBytes: 10 * 1024 * 1024 }));
    });
  });
});
