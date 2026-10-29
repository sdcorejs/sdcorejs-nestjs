import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const scratch = join(root, '.sdcorejs');
mkdirSync(scratch, { recursive: true });
const work = mkdtempSync(join(scratch, 'packed-postgres-single-flight-'));
const npm = process.env.npm_execpath;
assert.ok(npm?.endsWith('.js'), 'Run via npm run test:packed-single-flight');
try {
  const [packed] = JSON.parse(execFileSync(process.execPath, [npm, 'pack', '--ignore-scripts', '--json', '--pack-destination', work], { cwd: root, encoding: 'utf8', windowsHide: true }));
  assert.match(packed.filename, /^sdcorejs-nestjs-[a-zA-Z0-9.-]+\.tgz$/);
  const archive = join(work, packed.filename);
  assert.equal(packed.integrity, 'sha512-' + createHash('sha512').update(readFileSync(archive)).digest('base64'));
  execFileSync('tar', ['-xf', archive, '-C', work], { windowsHide: true });
  const consumer = join(work, 'package');
  symlinkSync(join(root, 'node_modules'), join(consumer, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  cpSync(join(root, 'scripts/packed-single-flight-consumer.mjs'), join(consumer, 'packed-single-flight-consumer.mjs'));
  for (const format of ['cjs', 'esm']) execFileSync(process.execPath, [join(consumer, 'packed-single-flight-consumer.mjs'), format], { cwd: consumer, stdio: 'inherit', windowsHide: true });
  console.log(JSON.stringify({ version: packed.version, integrity: packed.integrity, shasum: packed.shasum, result: 'PASS packed CJS and ESM single-flight/cache/Nest DI' }));
} finally {
  const target = realpathSync(work);
  assert.ok(target.startsWith(realpathSync(scratch) + sep));
  rmSync(target, { recursive: true, force: true });
}
