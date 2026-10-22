import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Test the actual npm tarball with the same locked dependency tree as CI.
// The temporary consumer only links dependencies; source and dist are never patched.
const root = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
assert.ok(process.env.CORE_TEST_DATABASE_URL, 'CORE_TEST_DATABASE_URL is required; this gate never skips');
const scratch = join(root, '.sdcorejs');
mkdirSync(scratch, { recursive: true });
const work = mkdtempSync(join(scratch, 'packed-postgres-'));
const npm = process.env.npm_execpath;
assert.ok(npm?.endsWith('.js'), 'Run this check via npm run test:postgres');
try {
  const packed = JSON.parse(
    execFileSync(process.execPath, [npm, 'pack', '--ignore-scripts', '--json', '--pack-destination', work], {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
    }),
  );
  assert.equal(packed.length, 1);
  assert.match(packed[0].filename, /^sdcorejs-nestjs-[a-zA-Z0-9.-]+\.tgz$/);
  execFileSync('tar', ['-xf', join(work, packed[0].filename), '-C', work], { windowsHide: true });
  const consumer = join(work, 'package');
  const packageJson = JSON.parse(readFileSync(join(consumer, 'package.json'), 'utf8'));
  assert.equal(packageJson.name, '@sdcorejs/nestjs');
  symlinkSync(join(root, 'node_modules'), join(consumer, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  cpSync(join(root, 'scripts', 'check-postgres-paging.mjs'), join(consumer, 'check-postgres-paging.mjs'));
  console.log(
    JSON.stringify({ package: packageJson.name, version: packageJson.version, integrity: packed[0].integrity, shasum: packed[0].shasum }),
  );
  for (const format of ['cjs', 'esm']) {
    execFileSync(process.execPath, [join(consumer, 'check-postgres-paging.mjs'), format], {
      cwd: consumer,
      env: process.env,
      stdio: 'inherit',
      windowsHide: true,
    });
  }
} finally {
  const target = realpathSync(work);
  assert.ok(target.startsWith(realpathSync(scratch) + sep), 'Refuse cleanup outside the owned scratch directory');
  // Node removes the owned junction itself, not its dependency target.
  rmSync(target, { recursive: true, force: true });
}
