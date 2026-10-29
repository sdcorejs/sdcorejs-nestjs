import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import 'reflect-metadata';
import { Test } from '@nestjs/testing';

const require = createRequire(import.meta.url);
const load = process.argv[2] === 'cjs' ? (id) => require(id) : (id) => import(id);
const { SingleFlightService } = await load('@sdcorejs/nestjs/utils');
const { CacheService } = await load('@sdcorejs/nestjs/services');
const moduleRef = await Test.createTestingModule({ providers: [SingleFlightService] }).compile();
try {
  const service = moduleRef.get(SingleFlightService);
  let calls = 0;
  const value = {};
  const promises = Array.from({ length: 50 }, () => service.run('scope', async () => { calls++; return value; }));
  for (const promise of promises) assert.equal(promise, promises[0]);
  for (const result of await Promise.all(promises)) assert.equal(result, value);
  assert.equal(calls, 1);
  assert.equal(await service.run('scope', () => 2), 2);
  const error = new Error('synthetic failure');
  for (const factory of [() => { throw error; }, () => Promise.reject(error)]) {
    const results = await Promise.allSettled([service.run('scope', factory), service.run('scope', factory)]);
    for (const result of results) { assert.equal(result.status, 'rejected'); assert.equal(result.reason, error); }
    assert.equal(await service.run('scope', () => 3), 3);
  }
  const cache = new CacheService();
  await assert.rejects(cache.load('scope', () => { throw error; }), (actual) => actual === error);
  assert.equal(await cache.load('scope', async () => 4), 4);
  assert.equal(await cache.load('scope', async () => 5), 4);
  await cache.onModuleDestroy();
  console.log(`${process.argv[2]} packed single-flight/cache/Nest DI: PASS`);
} finally {
  await moduleRef.close();
}
