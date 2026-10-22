import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import 'reflect-metadata';
import { Column, DataSource, DeleteDateColumn, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';

const format = process.argv[2];
assert.ok(['cjs', 'esm'].includes(format));
const root = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const entry = format === 'cjs' ? require.resolve('@sdcorejs/nestjs/core') : fileURLToPath(import.meta.resolve('@sdcorejs/nestjs/core'));
assert.equal(resolve(entry), resolve(root, 'dist', format, 'core', format === 'cjs' ? 'index.cjs' : 'index.mjs'));
const core = format === 'cjs' ? require('@sdcorejs/nestjs/core') : await import('@sdcorejs/nestjs/core');
const typeormVersion = JSON.parse(readFileSync(resolve(dirname(require.resolve('typeorm')), 'package.json'), 'utf8')).version;
assert.ok(process.env.CORE_TEST_DATABASE_URL, 'CORE_TEST_DATABASE_URL is required; this gate never skips');
const url = new URL(process.env.CORE_TEST_DATABASE_URL);
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
assert.ok(['/core_test', '/gov_test'].includes(url.pathname));
const schema = 'core_runner_' + randomUUID().replaceAll('-', '');
class Parent {}
class Item {}
for (const [target, name] of [[Parent, 'parent'], [Item, 'item']]) {
  Entity({ schema, name })(target);
  PrimaryColumn('uuid')(target.prototype, 'id');
  Column('varchar')(target.prototype, 'code');
  Column({ type: 'varchar', name: 'tenant_id' })(target.prototype, 'tenantId');
  Column({ type: 'varchar', name: 'unit_id' })(target.prototype, 'unitId');
  core.Scoped()(target.prototype, 'tenantId');
  core.Scoped()(target.prototype, 'unitId');
}
DeleteDateColumn({ type: 'timestamptz', name: 'deleted_at' })(Item.prototype, 'deletedAt');
ManyToOne(() => Parent, { nullable: true })(Item.prototype, 'parentLink');
JoinColumn({ name: 'parent_id' })(Item.prototype, 'parentLink');
core.SearchableFields({ exact: ['code'] })(Item);
class Repository extends core.BaseRepository {}
class Service extends core.BaseService { mapDTO(row) { return row ? { id: row.id, code: row.code } : null; } }
const queries = [];
const options = (max) => ({
  type: 'postgres', url: url.href, entities: [Item, Parent], synchronize: false,
  extra: { max, connectionTimeoutMillis: 1200 }, logging: ['query'],
  logger: {
    logQuery(sql, _parameters, runner) { queries.push({ sql, runner }); },
    logQueryError() {}, logQuerySlow() {}, logSchemaBuild() {}, logMigration() {}, log() {},
  },
});
const ds = new DataSource(options(10));
const single = new DataSource(options(1));
const uid = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const row = (n, code, extra = {}) => ({ id: uid(n), code, tenantId: 'A', unitId: 'U1', ...extra });
const eq = (field, data) => ({ field, operator: 'EQUAL', data });
const strategy = (scope) => ({ getCurrentScope: () => scope, shouldBypass: () => false });
const scoped = (source, scope = { tenantId: 'A', unitId: ['U1'] }) => new Repository(Item, source, { tenancyStrategy: strategy(scope) });
const cases = [];
const diagnostics = {};
const ownedRunners = new Set();
let schemaCreated = false;
async function transaction(source) {
  const qr = source.createQueryRunner();
  ownedRunners.add(qr);
  await qr.connect();
  await qr.startTransaction();
  return qr;
}
async function close(qr) {
  if (qr.isTransactionActive) await qr.rollbackTransaction();
  if (!qr.isReleased) await qr.release();
  ownedRunners.delete(qr);
}
async function check(name, action) {
  try { await action(); cases.push({ name, status: 'passed' }); }
  catch (error) { cases.push({ name, status: 'failed', error: error.message }); throw error; }
}
try {
  await ds.initialize();
  const [{ version: postgresVersion }] = await ds.query('SELECT version()');
  await ds.query('CREATE SCHEMA "' + schema + '"');
  schemaCreated = true;
  await ds.synchronize();

  // All ten owned transactions reach the barrier before any Core read. One deliberate
  // external waiter proves the pool is saturated; Core must finish without borrowing.
  await check('pool10 concurrent transactions finish reads while another connection waits', async () => {
    const runners = await Promise.all(Array.from({ length: 10 }, () => transaction(ds)));
    const pool = ds.driver.master;
    const pids = await Promise.all(runners.map(async (qr, i) => {
      await qr.manager.getRepository(Item).save(row(1000 + i, 'pool-' + i, { tenantId: 'T' + i }));
      return (await qr.query('SELECT pg_backend_pid() AS pid'))[0].pid;
    }));
    assert.equal(new Set(pids).size, 10);
    let acquired = 0;
    const countAcquire = () => acquired++;
    pool.on('acquire', countAcquire);
    const waiter = ds.query('SELECT 1 AS deliberate_waiter').then(() => ({ ok: true }), (error) => ({ error: error.message }));
    for (let i = 0; i < 50 && pool.waitingCount < 1; i++) await delay(2);
    assert.equal(pool.waitingCount, 1);
    queries.length = 0;
    let results;
    try {
      results = await Promise.allSettled(runners.map(async (qr, i) => {
        const repo = scoped(ds, { tenantId: 'T' + i, unitId: ['U1'] });
        const page = await repo.paging({ filters: [eq('id', uid(1000 + i))], orders: [{ field: 'code', direction: 'ASC' }] }, undefined, qr);
        assert.equal(page.total, 1);
        assert.deepEqual(page.items.map((item) => item.id), [uid(1000 + i)]);
        assert.equal((await qr.query('SELECT pg_backend_pid() AS pid'))[0].pid, pids[i]);
        assert.equal(qr.isTransactionActive, true);
        assert.equal(qr.isReleased, false);
      }));
      diagnostics.pool10 = { heldConnections: pids.length, waiting: pool.waitingCount, extraAcquires: acquired,
        fulfilled: results.filter((result) => result.status === 'fulfilled').length,
        rejected: results.filter((result) => result.status === 'rejected').length,
        errors: results.filter((result) => result.status === 'rejected').map((result) => ({
          name: result.reason.name, message: String(result.reason.message).replaceAll(url.password, '[redacted]'),
        })) };
      assert.equal(diagnostics.pool10.rejected, 0, 'Core reads must not borrow a second connection from the saturated pool');
      assert.equal(acquired, 0);
      assert.equal(pool.waitingCount, 1);
      assert.ok(queries.length >= 20);
      assert.ok(queries.every(({ runner }) => runners.includes(runner)));
    } finally {
      pool.off('acquire', countAcquire);
      await Promise.all(runners.map(close));
      await waiter;
    }
    assert.equal(await ds.getRepository(Item).count(), 0, 'caller rollback removes all uncommitted rows');
  });

  await single.initialize();
  const parents = await single.getRepository(Parent).save([row(101, 'parent'), row(102, 'foreign-parent', { tenantId: 'B' })]);
  await single.getRepository(Item).save([
    row(1, 'visible', { parentLink: parents[0] }), row(2, 'foreign', { tenantId: 'B' }),
    row(3, 'other-unit', { unitId: 'U2' }), row(4, 'deleted', { deletedAt: new Date('2020-01-01T00:00:00Z') }),
  ]);
  const snapshot = () => single.getRepository(Item).createQueryBuilder('e').withDeleted().orderBy('e.id').getRawMany();
  const before = await snapshot();
  const qr = await transaction(single);
  await qr.manager.getRepository(Item).save(row(5, 'pending', { parentLink: parents[1] }));
  const repo = scoped(single);
  const svc = new Service(repo);
  const args = { relations: ['parentLink'] };
  let acquired = 0;
  const countAcquire = () => acquired++;
  single.driver.master.on('acquire', countAcquire);
  const lifecycle = Object.fromEntries(['startTransaction', 'commitTransaction', 'rollbackTransaction', 'release'].map((name) => [name, 0]));
  const originals = {};
  for (const name of Object.keys(lifecycle)) {
    originals[name] = qr[name];
    qr[name] = function (...args) { lifecycle[name]++; return originals[name].apply(this, args); };
  }
  const ids = (items) => items.map((item) => item.id).sort();
  const expected = [uid(1), uid(5)];
  const pid = (await qr.query('SELECT pg_backend_pid() AS pid'))[0].pid;
  queries.length = 0;
  for (const direction of ['ASC', 'DESC']) {
    await check('pool1 JOIN paging ' + direction + ' sees uncommitted data and scopes relation', async () => {
      const page = await repo.paging({ pageSize: 1, orders: [{ field: 'code', direction }, { field: 'id', direction: 'ASC' }] }, args, qr);
      assert.equal(page.total, 2);
      const expectedId = direction === 'ASC' ? uid(5) : uid(1);
      assert.equal(page.items[0].id, expectedId);
      if (expectedId === uid(5)) assert.equal(page.items[0].parentLink, null);
    });
  }
  await check('pool1 pagingDeleted includes authorized soft-deleted rows', async () => {
    const page = await repo.pagingDeleted({ pageSize: 10 }, args, qr);
    assert.equal(page.total, 3);
    assert.deepEqual(ids(page.items), [uid(1), uid(4), uid(5)]);
  });
  await check('pool1 all AND caller OR filters remain under tenant and unit scope', async () => {
    const filters = [{ operator: 'OR', data: [eq('code', 'pending'), eq('tenantId', 'B'), eq('unitId', 'U2')] }];
    assert.deepEqual(ids(await repo.all(filters, args, qr)), [uid(5)]);
  });
  await check('pool1 regular search keeps caller filters', async () => {
    assert.deepEqual(ids(await repo.search('pending', [eq('id', uid(5))], qr)), [uid(5)]);
    assert.deepEqual(await repo.search('pending', [eq('id', uid(1))], qr), []);
  });
  await check('pool1 UUID search retains tenant/unit scope and existing shortcut semantics', async () => {
    assert.deepEqual(ids(await repo.search(uid(5), [eq('id', uid(1))], qr)), [uid(5)]);
    assert.deepEqual(await repo.search(uid(2), undefined, qr), []);
    assert.deepEqual(await repo.search(uid(3), undefined, qr), []);
  });
  await check('pool1 detail and findByIds keep authorized subset and joins', async () => {
    assert.equal((await repo.detail(uid(5), args, qr)).parentLink, null);
    assert.equal(await repo.detail(uid(2), args, qr), null);
    assert.deepEqual(ids(await repo.findByIds([uid(5), uid(2), uid(3), uid(5)], args, qr)), [uid(5)]);
    const length = queries.length;
    assert.deepEqual(await repo.findByIds([], undefined, qr), []);
    assert.equal(queries.length, length);
  });
  await check('pool1 every BaseService read forwards runner and maps DTOs', async () => {
    assert.deepEqual(ids((await svc.paging({}, args, qr)).items), expected);
    assert.equal((await svc.pagingDeleted({}, args, qr)).total, 3);
    assert.deepEqual(ids(await svc.all(undefined, args, qr)), expected);
    assert.deepEqual(await svc.search('pending', undefined, qr), [{ id: uid(5), code: 'pending' }]);
    assert.deepEqual(await svc.detail(uid(5), args, qr), { id: uid(5), code: 'pending' });
  });
  await check('pool1 empty unit scope denies; missing required scope rejects before SQL', async () => {
    assert.deepEqual(await scoped(single, { tenantId: 'A', unitId: [] }).all(undefined, args, qr), []);
    for (const scope of [{}, { tenantId: 'A' }, { unitId: ['U1'] }]) {
      const length = queries.length;
      await assert.rejects(() => scoped(single, scope).paging({}, args, qr));
      assert.equal(queries.length, length);
    }
  });
  await check('pool1 invalid filters and sorts reject without losing transaction', async () => {
    const length = queries.length;
    await assert.rejects(() => repo.paging({ filters: [{ field: 'code', operator: 'EXECUTE', data: 'x' }] }, args, qr));
    await assert.rejects(() => repo.paging({ orders: [{ field: 'code;DROP TABLE item', direction: 'ASC' }] }, args, qr));
    assert.equal(queries.length, length);
    assert.deepEqual(ids(await repo.all(undefined, args, qr)), expected);
  });
  await check('pool1 valid and invalid read operations never acquire or change caller lifecycle', async () => {
    assert.equal((await qr.query('SELECT pg_backend_pid() AS pid'))[0].pid, pid);
    assert.equal(acquired, 0);
    assert.ok(queries.every(({ runner }) => runner === qr));
    assert.deepEqual(lifecycle, { startTransaction: 0, commitTransaction: 0, rollbackTransaction: 0, release: 0 });
    diagnostics.pool1 = { extraAcquires: acquired, sameBackend: true, reads: queries.length, lifecycle };
  });
  single.driver.master.off('acquire', countAcquire);
  for (const [name, original] of Object.entries(originals)) qr[name] = original;
  await close(qr);
  await check('caller rollback leaves committed rows unchanged; no-runner reads stay compatible', async () => {
    assert.deepEqual(await snapshot(), before);
    assert.deepEqual(ids(await repo.all()), [uid(1)]);
  });
  await check('actual released/inactive/foreign runners reject before SQL', async () => {
    const inactive = single.createQueryRunner();
    const foreign = await transaction(ds);
    try {
      const length = queries.length;
      for (const invalid of [null, false, {}, qr, inactive, foreign]) {
        await assert.rejects(() => repo.findByIds([], undefined, invalid), (error) => error.response?.code === 'core.repository.invalid-query-runner');
      }
      assert.equal(queries.length, length);
    } finally { await inactive.release(); await close(foreign); }
  });
  await check('database error leaves caller transaction active until caller rolls back', async () => {
    const failing = await transaction(single);
    try {
      await assert.rejects(() => repo.all(undefined, { andWheres: [{ where: '1 / 0 = 0' }] }, failing), (error) => error.code === '22012');
      assert.equal(failing.isTransactionActive, true);
      assert.equal(failing.isReleased, false);
      await assert.rejects(() => failing.query('SELECT 1'), (error) => error.code === '25P02');
    } finally { await close(failing); }
    assert.deepEqual(await snapshot(), before);
  });
  console.log(JSON.stringify({ suite: 'caller-owned-read-runner', format, packedEntry: relative(root, entry), status: 'passed',
    postgresVersion, typeormVersion, nodeVersion: process.version, diagnostics, cases, count: cases.length }));
} catch (error) {
  console.error(JSON.stringify({ suite: 'caller-owned-read-runner', format, status: 'failed', diagnostics, cases,
    error: { name: error.name, message: error.message.replaceAll(url.password, '[redacted]') } }));
  process.exitCode = 1;
} finally {
  for (const qr of ownedRunners) await close(qr);
  if (single.isInitialized) await single.destroy();
  if (schemaCreated) {
    assert.match(schema, /^core_runner_[a-f0-9]{32}$/);
    await ds.query('DROP SCHEMA "' + schema + '" CASCADE');
  }
  if (ds.isInitialized) await ds.destroy();
}
