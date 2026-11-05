import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const jestRequire = createRequire(require.resolve('jest-config'));
const merge = jestRequire('deepmerge');
const payload = () => JSON.parse('{"__proto__":{"polluted":true},"safe":1}');

for (const [name, target, source] of [
  ['null-prototype target', Object.create(null), payload()],
  ['own proto in source', payload(), payload()],
  ['own proto in target', payload(), {}],
  ['nested null placeholder', { nested: null }, { nested: payload() }],
  ['array element', { list: [] }, { list: [payload()] }],
]) test(`blocks prototype poisoning: ${name}`, () => {
  const result = merge(target, source);
  const value = result.nested ?? result.list?.[0] ?? result;
  assert.equal(Object.getPrototypeOf(value), Object.prototype);
  assert.equal(value.polluted, undefined);
  assert.equal(Object.hasOwn(value, '__proto__'), false);
  assert.equal({}.polluted, undefined);
});

test('drops dangerous keys before reading their values on both sides', () => {
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    const object = Object.create(null);
    Object.defineProperty(object, key, { enumerable: true, get() { throw new Error('must not read'); } });
    assert.deepEqual(merge(object, {}), {});
    assert.deepEqual(merge({}, object), {});
  }
});

test('preserves Jest merge semantics for arrays, symbols, functions, regex and dates without mutation', () => {
  const symbol = Symbol('config');
  const fn = () => 1;
  const date = new Date(0);
  const regex = /test/u;
  const left = { nested: { left: true }, list: [{ n: 1 }], fn, date, regex, [symbol]: { n: 1 } };
  const right = { nested: { right: true }, list: [2], [symbol]: { m: 2 } };
  const merged = merge.all([left, right]);
  assert.deepEqual(merged.nested, { left: true, right: true });
  assert.deepEqual(merged.list, [{ n: 1 }, 2]);
  assert.notEqual(merged.list[0], left.list[0]);
  assert.deepEqual(left.list, [{ n: 1 }]);
  assert.equal(merged.fn, fn);
  assert.equal(merged.date, date);
  assert.equal(merged.regex, regex);
  assert.deepEqual(merged[symbol], { n: 1, m: 2 });
  assert.throws(() => merge.all({}));
});

test('rejects proxy membership failures instead of assuming a property is safe', () => {
  const error = new Error('membership failed');
  const target = new Proxy({}, { has() { throw error; } });
  assert.throws(() => merge(target, { safe: 1 }), (actual) => actual === error);
});

test('Jest mergeConfig uses the hardened implementation', () => {
  const { mergeConfig } = require('jest-config');
  const merged = mergeConfig({ globals: { service: null } }, { globals: { service: payload() } });
  assert.equal(merged.globals.service.polluted, undefined);
  assert.equal(Object.getPrototypeOf(merged.globals.service), Object.prototype);
  assert.equal(merged.globals.service.safe, 1);
});
