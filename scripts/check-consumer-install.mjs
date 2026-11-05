import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { evaluateAudit, releaseIdentity } from './core-release-audit.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'test-results/release-audit');
fs.mkdirSync(output, { recursive: true });
fs.rmSync(path.join(output, 'consumer-receipt.json'), { force: true });
const identity = releaseIdentity(root);
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'sdcorejs-consumer-'));
const npmCli = process.env.npm_execpath;
assert.ok(npmCli?.endsWith('.js'), 'Run through npm run test:consumer-install');
const npm = (args, cwd) => execFileSync(process.execPath, [npmCli, ...args], {
  cwd, encoding: 'utf8', windowsHide: true, timeout: 240_000, maxBuffer: 16e6,
});
const backports = JSON.parse(fs.readFileSync(path.join(root, 'backports/manifest.json')));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
for (const record of backports) {
  assert.ok(!pkg.dependencies?.[record.name], 'Backports must remain peer-only');
  const url = new URL(pkg.peerDependencies[record.name]);
  assert.equal(url.origin, 'https://raw.githubusercontent.com');
  const segments = url.pathname.split('/');
  assert.deepEqual(segments.slice(0, 3), ['', 'sdcorejs', 'sdcorejs-nestjs']);
  assert.match(segments[3], /^[a-f0-9]{40}$/);
  assert.deepEqual(segments.slice(4), ['backports', record.file]);
  assert.equal(url.search + url.hash, '');
}
const receipts = [];
try {
  const [packed] = JSON.parse(npm(['pack', '--ignore-scripts', '--json', '--pack-destination', work], root));
  assert.equal(path.basename(packed.filename), packed.filename);
  const archive = path.join(work, packed.filename);
  for (const scope of ['consumer-fresh', 'consumer-upgrade']) {
    const cwd = path.join(work, scope);
    fs.mkdirSync(cwd);
    const dependencies = { '@nestjs/testing': '11.2.8', pg: '^8.21.0' };
    if (scope === 'consumer-upgrade') Object.assign(dependencies, {
      '@sdcorejs/nestjs': '1.3.0', typeorm: '0.3.31', '@nestjs/platform-express': '11.2.8',
      '@nestjs/common': '11.2.8', '@nestjs/core': '11.2.8',
    });
    fs.writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({ name: scope, version: '0.0.0', private: true, dependencies }));
    if (scope === 'consumer-upgrade') npm(['install', '--ignore-scripts', '--no-audit'], cwd);
    npm(['install', archive, '--ignore-scripts', '--no-audit'], cwd);
    const lock = JSON.parse(fs.readFileSync(path.join(cwd, 'package-lock.json')));
    for (const record of backports) {
      const matches = Object.entries(lock.packages).filter(([key]) => key.endsWith('/node_modules/' + record.name) || key === 'node_modules/' + record.name);
      assert.equal(matches.length, 1, `${scope}: exactly one ${record.name}`);
      assert.equal(matches[0][0], 'node_modules/' + record.name, `${scope}: shared root installation`);
      assert.equal(matches[0][1].resolved, pkg.peerDependencies[record.name]);
      assert.equal(matches[0][1].integrity, record.integrity);
    }
    for (const script of ['consumer-dependency-identity.mjs', 'packed-single-flight-consumer.mjs']) {
      fs.copyFileSync(path.join(root, 'scripts', script), path.join(cwd, script));
    }
    execFileSync(process.execPath, [path.join(cwd, 'consumer-dependency-identity.mjs')], { cwd, stdio: 'inherit', windowsHide: true });
    for (const format of ['cjs', 'esm']) {
      execFileSync(process.execPath, [path.join(cwd, 'packed-single-flight-consumer.mjs'), format], { cwd, stdio: 'inherit', windowsHide: true });
      if (process.argv.includes('--postgres')) {
        assert.ok(process.env.CORE_TEST_DATABASE_URL, 'PostgreSQL URL required');
        const installed = path.join(cwd, 'node_modules/@sdcorejs/nestjs');
        for (const script of ['check-postgres-paging.mjs', 'check-postgres-read-runner.mjs']) {
          fs.copyFileSync(path.join(root, 'scripts', script), path.join(installed, script));
          execFileSync(process.execPath, [path.join(installed, script), format], { cwd, stdio: 'inherit', windowsHide: true });
        }
      }
    }
    const audit = spawnSync(process.execPath, [npmCli, 'audit', '--omit=dev', '--json'], { cwd, encoding: 'utf8', timeout: 120_000, maxBuffer: 16e6, windowsHide: true });
    assert.ok(!audit.error && !audit.signal, 'Consumer audit command failed');
    fs.writeFileSync(path.join(output, scope + '.json'), audit.stdout ?? '');
    const result = evaluateAudit({ report: JSON.parse(audit.stdout), exit: audit.status, scope });
    receipts.push({ ...result, at: new Date().toISOString(), identity, integrity: packed.integrity,
      postgres: process.argv.includes('--postgres'), lockSha256: createHash('sha256').update(fs.readFileSync(path.join(cwd, 'package-lock.json'))).digest('hex') });
    console.log(`${scope}: clean audit, shared identities and CJS/ESM consumer checks PASS`);
  }
  assert.deepEqual(releaseIdentity(root), identity, 'Release inputs changed during consumer verification');
  fs.writeFileSync(path.join(output, 'consumer-receipt.json'), JSON.stringify(receipts, null, 2) + '\n');
} finally {
  assert.equal(path.dirname(fs.realpathSync(work)), fs.realpathSync(os.tmpdir()));
  fs.rmSync(work, { recursive: true, force: true });
}
