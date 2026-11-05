import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(root, 'backports/manifest.json');
export const integrity = (bytes) => 'sha512-' + createHash('sha512').update(bytes).digest('base64');

// Preserve every upstream tar member byte-for-byte except package.json.
// No upstream scripts run, and no tar member is extracted to the filesystem.
export function patchArchive(archive, record, license) {
  assert.equal(integrity(archive), record.upstreamIntegrity, 'Upstream integrity mismatch');
  const tar = gunzipSync(archive);
  const output = [];
  const names = new Set();
  let patched = 0;
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((value) => value === 0)) break;
    const string = (start, end) => header.toString('utf8', start, end).split('\0')[0];
    const prefix = string(345, 500);
    const name = (prefix ? prefix + '/' : '') + string(0, 100);
    assert.ok(name.startsWith('package/') && !name.split('/').includes('..') && !names.has(name));
    names.add(name);
    assert.equal(string(156, 157), '0', 'Only regular upstream members are allowed');
    const size = Number.parseInt(string(124, 136).trim(), 8);
    assert.ok(Number.isSafeInteger(size) && size >= 0 && offset + 512 + size <= tar.length);
    const checksum = [...header].reduce((sum, value, i) => sum + (i >= 148 && i < 156 ? 32 : value), 0);
    assert.equal(checksum, Number.parseInt(string(148, 156).trim(), 8), 'Tar header checksum mismatch');
    const end = offset + 512 + Math.ceil(size / 512) * 512;
    if (name === 'package/package.json') {
      const pkg = JSON.parse(tar.toString('utf8', offset + 512, offset + 512 + size));
      assert.equal(pkg.name, record.name);
      assert.equal(pkg.version, record.version);
      for (const [dependency, expected] of Object.entries(record.dependenciesBefore)) {
        assert.equal(pkg.dependencies[dependency], expected, 'Unexpected upstream dependency');
      }
      Object.assign(pkg.dependencies, record.dependenciesAfter);
      pkg.sdcorejsBackport = {
        revision: 1,
        upstream: `${record.name}@${record.version}`,
        upstreamIntegrity: record.upstreamIntegrity,
        dependencies: record.dependenciesAfter,
        description: 'SDCoreJS dependency metadata backport; upstream runtime code and licenses unchanged. Not an upstream release.',
      };
      const bytes = Buffer.from(JSON.stringify(pkg, null, 2) + '\n');
      const changed = Buffer.from(header);
      changed.write(bytes.length.toString(8).padStart(11, '0') + '\0', 124, 12, 'ascii');
      changed.fill(32, 148, 156);
      const sum = [...changed].reduce((a, b) => a + b, 0);
      changed.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
      output.push(changed, bytes, Buffer.alloc((512 - bytes.length % 512) % 512));
      patched++;
    } else output.push(tar.subarray(offset, end));
    offset = end;
  }
  assert.equal(patched, 1, 'Exactly one manifest must be patched');
  if (record.additionalLicense) {
    assert.ok(!names.has('package/LICENSE'));
    assert.equal(integrity(license), record.additionalLicense.integrity);
    const header = Buffer.alloc(512);
    header.write('package/LICENSE');
    header.write('0000644\0', 100);
    header.write('0000000\0', 108);
    header.write('0000000\0', 116);
    header.write(license.length.toString(8).padStart(11, '0') + '\0', 124);
    header.write('00000000000\0', 136);
    header.fill(32, 148, 156);
    header.write('0', 156);
    header.write('ustar\0', 257);
    header.write('00', 263);
    header.write([...header].reduce((a, b) => a + b, 0).toString(8).padStart(6, '0') + '\0 ', 148);
    output.push(header, license, Buffer.alloc((512 - license.length % 512) % 512));
  }
  output.push(Buffer.alloc(1024));
  const compressed = gzipSync(Buffer.concat(output), { level: 9, mtime: 0 });
  compressed[9] = 255; // Canonical unknown OS; do not embed the builder's platform.
  return compressed;
}

export async function buildBackports({ write = false } = {}) {
  const records = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  for (const record of records) {
    assert.equal(path.basename(record.file), record.file);
    assert.ok(record.upstream.startsWith('https://registry.npmjs.org/'));
    const response = await fetch(record.upstream, { signal: AbortSignal.timeout(60_000) });
    assert.ok(response.ok, `Upstream download failed: ${response.status}`);
    const license = record.additionalLicense && fs.readFileSync(path.join(root, 'backports', record.additionalLicense.file));
    const patched = patchArchive(Buffer.from(await response.arrayBuffer()), record, license);
    const target = path.join(root, 'backports', record.file);
    if (write) {
      fs.writeFileSync(target, patched);
      record.integrity = integrity(patched);
    } else {
      const committed = fs.readFileSync(target);
      assert.equal(integrity(committed), record.integrity, 'Committed artifact integrity mismatch');
      // zlib versions may encode identical tar bytes differently. Verify the shipped
      // compressed bytes against their recorded hash, and reproduce tar content exactly.
      assert.deepEqual(gunzipSync(committed), gunzipSync(patched), 'Committed tar content differs from reproduction');
    }
    console.log(`${write ? 'Built' : 'Verified'} ${record.file}: ${record.integrity}`);
  }
  if (write) fs.writeFileSync(manifestPath, JSON.stringify(records, null, 2) + '\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildBackports({ write: process.argv.includes('--write') });
}
