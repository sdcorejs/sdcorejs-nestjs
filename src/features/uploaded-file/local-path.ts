import { lstat, mkdir, realpath } from 'node:fs/promises';
import { isAbsolute, join, posix, relative, resolve, sep, win32 } from 'node:path';

export class LocalStoragePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LocalStoragePathError';
  }
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
}

/**
 * Canonical path resolver shared by every local-storage filesystem operation.
 *
 * The configured root and its parents must be owned by a trusted same-host operator and must not
 * be concurrently writable by untrusted OS users. Web-controlled keys remain contained here, but
 * no path-only API can defend against a hostile local user replacing trusted directories.
 */
export class SafeLocalPathResolver {
  private readonly configuredRoot: string;
  private rootPromise?: Promise<string>;

  constructor(root: string) {
    this.configuredRoot = resolve(root);
  }

  private async canonicalRoot(): Promise<string> {
    this.rootPromise ??= (async () => {
      await mkdir(this.configuredRoot, { recursive: true });
      return realpath(this.configuredRoot);
    })();
    return this.rootPromise;
  }

  private segments(key: string): string[] {
    if (!key || key.includes('\0') || isAbsolute(key) || posix.isAbsolute(key) || win32.isAbsolute(key) || /%(?:2e|2f|5c)/i.test(key)) {
      throw new LocalStoragePathError('Invalid local storage key');
    }
    const parts = key.split(/[\\/]/);
    if (parts.some((part) => !part || part === '.' || part === '..')) throw new LocalStoragePathError('Invalid local storage key');
    return parts;
  }

  private assertContained(root: string, target: string): void {
    const rel = relative(root, target);
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw new LocalStoragePathError('Resolved path is outside the local storage root');
    }
  }

  private async ensureSafeParent(root: string, parts: readonly string[]): Promise<void> {
    let current = root;
    for (const part of parts) {
      current = join(current, part);
      try {
        const stat = await lstat(current);
        if (stat.isSymbolicLink() || !stat.isDirectory()) {
          throw new LocalStoragePathError('Resolved path escapes the canonical local storage root');
        }
      } catch (error) {
        if (!isMissing(error)) throw error;
        try {
          await mkdir(current);
        } catch (mkdirError) {
          if ((mkdirError as NodeJS.ErrnoException).code !== 'EEXIST') throw mkdirError;
        }
        const created = await lstat(current);
        if (created.isSymbolicLink() || !created.isDirectory()) {
          throw new LocalStoragePathError('Resolved path escapes the canonical local storage root');
        }
      }
      const canonical = await realpath(current);
      this.assertContained(root, canonical);
    }
  }

  async resolveForWrite(key: string): Promise<string> {
    const root = await this.canonicalRoot();
    const parts = this.segments(key);
    const target = resolve(root, ...parts);
    this.assertContained(root, target);
    await this.ensureSafeParent(root, parts.slice(0, -1));
    return target;
  }

  async resolveExisting(key: string): Promise<string> {
    const root = await this.canonicalRoot();
    const parts = this.segments(key);
    const lexical = resolve(root, ...parts);
    this.assertContained(root, lexical);
    const stat = await lstat(lexical);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new LocalStoragePathError('Local storage target is not a regular file');
    const canonical = await realpath(lexical);
    this.assertContained(root, canonical);
    return canonical;
  }
}
