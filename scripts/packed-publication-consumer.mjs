import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const format = process.argv[2];
assert.ok(['cjs', 'esm'].includes(format));
const api = format === 'cjs' ? createRequire(import.meta.url)('@sdcorejs/nestjs/features') : await import('@sdcorejs/nestjs/features');
assert.equal(api.UPLOADED_FILE_PUBLICATION_API_VERSION, 1);
for (const name of ['createUploadedFilePublicationCoordinator', 'createUploadedFilePublicationStorage', 'runUploadedFilePublicationConformance', 'UploadedFilePublicationError']) assert.equal(typeof api[name], 'function', name);
const bytes = Buffer.from('packed-publication-synthetic');
const binding = { environment: 'dev', module: 'test', scopeId: 'scope', bindingId: 'logo', generation: 'v1' };
const source = { id: 'file', version: 'v1', locator: 'private-original', sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length, contentType: 'text/plain' };
const objects = new Map();
let reads = 0, stages = 0, retired = 0;
const storage = api.createUploadedFilePublicationStorage({
  deliveryProfile: { id: 'synthetic-profile', cdnBaseUrl: 'https://cdn.example.test', mode: 'external' },
  readSource: async input => { assert.deepEqual(input, source); reads++; return { bytes, version: source.version }; },
  objects: {
    headExact: async key => objects.get(key) ?? null,
    putImmutable: async (key, data, metadata) => { assert.deepEqual(Buffer.from(data), bytes); if (objects.has(key)) return 'conflict'; objects.set(key, metadata); return 'acknowledged'; },
    deleteExact: async (key, descriptorHash) => { assert.equal(objects.get(key)?.descriptorHash, descriptorHash); objects.delete(key); return 'acknowledged'; },
  },
});
let stored;
const unexpected = () => { throw Error('Unexpected repository lifecycle call'); };
const repository = {
  stage: async (transaction, intent) => { assert.equal(transaction, 'owned-transaction'); stored = intent; stages++; return intent; },
  retireLogicalBinding: async transaction => { assert.equal(transaction, 'owned-transaction'); retired++; },
  retire: unexpected, claim: unexpected, isCurrent: unexpected, commitReady: unexpected, record: unexpected,
  readCurrent: async () => stored ? { intent: stored, state: 'pending' } : null,
};
const config = { environment: 'dev', keyPrefix: '', modulePrefixes: { test: 'app-test' }, cdnBaseUrl: 'https://cdn.example.test', deliveryMode: 'external' };
const coordinator = api.createUploadedFilePublicationCoordinator({ config, policy: { resolve: async assignment => assignment }, repository, storage });
assert.deepEqual(await coordinator.stage({ visibility: 'private', binding }, 'owned-transaction'), { visibility: 'private', intentId: null });
assert.equal(retired, 1); assert.equal(stages, 0); assert.equal(reads, 0);
const staged = await coordinator.stage({ visibility: 'public', binding, source }, 'owned-transaction');
assert.equal(staged.visibility, 'public'); assert.equal(staged.intentId, stored.id);
assert.match(stored.target.key, /^dev\/app-test\/public\//);
assert.equal((await coordinator.project(binding)).url, null, 'Pending publication must never expose its formatted URL');
assert.equal(await storage.inspect(stored, new AbortController().signal), 'absent');
assert.equal(await storage.publish(stored, new AbortController().signal), 'acknowledged');
assert.equal(await storage.inspect(stored, new AbortController().signal), 'matching');
assert.equal(await storage.removeExact(stored, new AbortController().signal), 'acknowledged');
assert.equal(objects.size, 0); assert.equal(reads, 1);
await assert.rejects(coordinator.stage({ visibility: 'public', binding: { ...binding, environment: 'main' }, source }, 'owned-transaction'));
await assert.rejects(coordinator.stage({ visibility: 'public', binding: { ...binding, module: 'foreign' }, source }, 'owned-transaction'));
const absentConfig = api.createUploadedFilePublicationCoordinator({ config: { environment: 'dev', keyPrefix: '', modulePrefixes: { test: 'app-test' } }, policy: { resolve: async assignment => assignment }, repository, storage });
await assert.rejects(absentConfig.stage({ visibility: 'public', binding, source }, 'owned-transaction'));
assert.equal(stages, 1, 'Rejected assignments cannot stage an intent');
console.log(JSON.stringify({ format, status: 'PASS', checks: ['public capability', 'private default', 'transaction identity', 'pending URL hidden', 'immutable storage round-trip', 'cross-environment denied', 'cross-module denied', 'missing config denied'], realDatabase: false, realProvider: false }));
