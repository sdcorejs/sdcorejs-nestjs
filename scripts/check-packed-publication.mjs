import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const scratch = join(root, '.sdcorejs');
mkdirSync(scratch, { recursive: true });
const work = mkdtempSync(join(scratch, 'packed-postgres-publication-'));
const npm = process.env.npm_execpath;
assert.ok(npm?.endsWith('.js'), 'Run via npm run test:packed-publication');
try {
  const packed = JSON.parse(execFileSync(process.execPath, [npm, 'pack', '--ignore-scripts', '--json', '--pack-destination', work], { cwd: root, encoding: 'utf8', windowsHide: true }));
  assert.equal(packed.length, 1);
  assert.match(packed[0].filename, /^sdcorejs-nestjs-[a-zA-Z0-9.-]+\.tgz$/);
  execFileSync('tar', ['-xf', join(work, packed[0].filename), '-C', work], { windowsHide: true });
  const consumer = join(work, 'package');
  const manifest = JSON.parse(readFileSync(join(consumer, 'package.json'), 'utf8'));
  assert.equal(manifest.name, '@sdcorejs/nestjs');
  assert.ok(readFileSync(join(consumer, 'docs/uploaded-file-publication.md'), 'utf8').includes('Durable repository responsibilities'));
  symlinkSync(join(root, 'node_modules'), join(consumer, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  cpSync(join(root, 'scripts/packed-publication-consumer.mjs'), join(consumer, 'packed-publication-consumer.mjs'));
  console.log(JSON.stringify({ package: manifest.name, version: manifest.version, integrity: packed[0].integrity, shasum: packed[0].shasum, environment: 'packed consumer, synthetic ports, no database/provider' }));
  for (const format of ['cjs', 'esm']) execFileSync(process.execPath, [join(consumer, 'packed-publication-consumer.mjs'), format], { cwd: consumer, env: process.env, stdio: 'inherit', windowsHide: true });
} finally {
  const target = realpathSync(work);
  assert.ok(target.startsWith(realpathSync(scratch) + sep));
  rmSync(target, { recursive: true, force: true });
}
