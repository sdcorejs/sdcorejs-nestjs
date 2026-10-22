import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import 'reflect-metadata';
import { Column, DataSource, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';

// This script is copied into the unpacked npm tarball by check-packed-postgres.
// Both imports therefore exercise package exports, never TypeScript source.
const format = process.argv[2];
assert.ok(['cjs', 'esm'].includes(format), 'Expected cjs or esm');
const packageRoot = dirname(fileURLToPath(import.meta.url));
const entry =
  format === 'cjs'
    ? createRequire(import.meta.url).resolve('@sdcorejs/nestjs/core')
    : fileURLToPath(import.meta.resolve('@sdcorejs/nestjs/core'));
assert.equal(resolve(entry), resolve(packageRoot, 'dist', format, 'core', format === 'cjs' ? 'index.cjs' : 'index.mjs'));
console.log(JSON.stringify({ format, packedEntry: relative(packageRoot, entry) }));
const core = format === 'cjs' ? createRequire(import.meta.url)('@sdcorejs/nestjs/core') : await import('@sdcorejs/nestjs/core');
const require = createRequire(import.meta.url);
const typeormVersion = JSON.parse(readFileSync(resolve(dirname(require.resolve('typeorm')), 'package.json'), 'utf8')).version;
assert.ok(process.env.CORE_TEST_DATABASE_URL, 'CORE_TEST_DATABASE_URL is required; this gate never skips');
const url = new URL(process.env.CORE_TEST_DATABASE_URL);
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Only a local disposable PostgreSQL fixture is allowed');
assert.ok(['/core_test', '/gov_test'].includes(url.pathname), 'Unexpected fixture database');
const schema = 'core_paging_' + randomUUID().replaceAll('-', '');
class Leaf {}
class Child {}
class Item {}
for (const [entity, name] of [
  [Leaf, 'leaf'],
  [Child, 'child'],
  [Item, 'item'],
]) {
  Entity({ schema, name })(entity);
  PrimaryColumn('uuid')(entity.prototype, 'id');
  Column({ type: 'varchar' })(entity.prototype, 'code');
  Column({ type: 'varchar', name: 'display_name', nullable: true })(entity.prototype, 'displayName');
  Column({ type: 'varchar', select: false, default: 'private-fixture-value' })(entity.prototype, 'privateValue');
  Column({ type: 'varchar', name: 'tenant_id' })(entity.prototype, 'tenantId');
  Column({ type: 'varchar', name: 'unit_id' })(entity.prototype, 'unitId');
  core.Scoped()(entity.prototype, 'tenantId');
  core.Scoped()(entity.prototype, 'unitId');
}
function relation(from, property, to, column) {
  ManyToOne(() => to, { nullable: true })(from.prototype, property);
  JoinColumn({ name: column })(from.prototype, property);
}
relation(Child, 'relatedChild', Leaf, 'related_child_id');
relation(Item, 'parentLink', Child, 'parent_id');
relation(Item, 'sibling_link', Child, 'sibling_id');
const uid = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const queries = [];
const ds = new DataSource({
  type: 'postgres',
  url: url.href,
  entities: [Leaf, Child, Item],
  synchronize: false,
  logging: ['query'],
  logger: {
    logQuery(query, parameters) {
      queries.push({ query, parameters });
    },
    logQueryError() {},
    logQuerySlow() {},
    logSchemaBuild() {},
    logMigration() {},
    log() {},
  },
});
const cases = [];
async function check(name, action) {
  try {
    await action();
    cases.push({ name, status: 'passed' });
  } catch (error) {
    cases.push({ name, status: 'failed', error: error.message });
    throw error;
  }
}
const strategy = (scope) => ({ getCurrentScope: () => scope, shouldBypass: () => false });
class Repository extends core.BaseRepository {}
const scope = { tenantId: 'A', unitId: ['U1'] };
const args = { relations: ['parentLink.relatedChild', 'sibling_link'] };
let schemaCreated = false;
try {
  await ds.initialize();
  const [{ version: postgresVersion }] = await ds.query('SELECT version()');
  await ds.query('CREATE SCHEMA "' + schema + '"');
  schemaCreated = true;
  await ds.synchronize();
  const row = (id, code, displayName, extra = {}) => ({ id: uid(id), code, displayName, tenantId: 'A', unitId: 'U1', ...extra });
  const leaves = await ds
    .getRepository(Leaf)
    .save([row(101, 'L1', 'Alpha'), row(102, 'L2', 'Beta'), row(103, 'LX', 'Foreign', { tenantId: 'B' })]);
  const children = await ds
    .getRepository(Child)
    .save([
      row(201, 'A', 'Alpha', { relatedChild: leaves[0] }),
      row(202, 'B', 'Beta', { relatedChild: leaves[1] }),
      row(203, 'N', null),
      row(204, 'X', 'Foreign', { tenantId: 'B' }),
      row(205, 'Y', 'Foreign unit', { unitId: 'U2' }),
      row(206, 'D', 'Gamma', { relatedChild: leaves[2] }),
    ]);
  const specs = [
    [1, 'Beta', 0],
    [2, 'Alpha', 1],
    [3, 'Alpha', 0],
    [4, null, 2],
    [5, 'Zeta', 3],
    [6, 'Omega', 4],
    [7, 'Eta', 5],
  ];
  await ds
    .getRepository(Item)
    .save([
      ...specs.map(([id, name, child]) => row(id, 'R' + id, name, { parentLink: children[child], sibling_link: children[child] })),
      row(8, 'R8', 'Other tenant', { tenantId: 'B', parentLink: children[0] }),
      row(9, 'R9', 'Other unit', { unitId: 'U2', parentLink: children[0] }),
    ]);
  const repo = new Repository(Item, ds, { tenancyStrategy: strategy(scope) });
  const ids = (response) => response.items.map((item) => Number(item.id.slice(-12)));
  const snapshot = async () =>
    Promise.all(
      [Item, Child, Leaf].map((entity) =>
      ds.getRepository(entity).createQueryBuilder('e').addSelect('e.privateValue').orderBy('e.id', 'ASC').getRawMany(),
      ),
    );
  const before = await snapshot();
  // Explicit expected order is independent of TypeORM/Core's own sorting.
  const sorts = [
    ['id', [1, 2, 3, 4, 5, 6, 7], [7, 6, 5, 4, 3, 2, 1]],
    ['code', [1, 2, 3, 4, 5, 6, 7], [7, 6, 5, 4, 3, 2, 1]],
    ['displayName', [4, 2, 3, 1, 7, 6, 5], [5, 6, 7, 1, 2, 3, 4]],
    ['parentLink.code', [5, 6, 1, 3, 2, 7, 4], [4, 7, 2, 1, 3, 5, 6]],
    ['parentLink.displayName', [4, 5, 6, 1, 3, 2, 7], [7, 2, 1, 3, 4, 5, 6]],
    ['sibling_link.displayName', [4, 5, 6, 1, 3, 2, 7], [7, 2, 1, 3, 4, 5, 6]],
    ['parentLink.relatedChild.displayName', [4, 5, 6, 7, 1, 3, 2], [2, 1, 3, 4, 5, 6, 7]],
  ];
  for (const [field, asc, desc] of sorts) {
    for (const [direction, expected] of [
      ['ASC', asc],
      ['DESC', desc],
    ]) {
      await check('JOIN paging ' + field + ' ' + direction + ' null/ties/count/all pages', async () => {
        const orders = [{ field, direction }, ...(field === 'id' ? [] : [{ field: 'id', direction: 'ASC' }])];
        const all = [];
        for (let pageNumber = 0; pageNumber < 5; pageNumber++) {
          const page = await repo.paging({ pageNumber, pageSize: 2, orders }, args);
          assert.equal(page.total, 7);
          assert.deepEqual(ids(page), expected.slice(pageNumber * 2, pageNumber * 2 + 2));
          all.push(...ids(page));
        }
        assert.deepEqual(all, expected);
        assert.equal(new Set(all).size, 7);
      });
    }
  }
  await check('multi-field mixed directions', async () => {
    const page = await repo.paging(
      {
        pageSize: 10,
        orders: [
          { field: 'displayName', direction: 'ASC' },
          { field: 'id', direction: 'DESC' },
        ],
      },
      args,
    );
    assert.deepEqual(ids(page), [4, 3, 2, 1, 7, 6, 5]);
  });
  await check('no JOIN ordered paging remains compatible', async () => {
    assert.deepEqual(
      ids(
        await repo.paging({
          pageSize: 2,
          orders: [
            { field: 'displayName', direction: 'ASC' },
            { field: 'id', direction: 'ASC' },
          ],
        }),
      ),
      [4, 2],
    );
  });
  await check('JOIN without explicit orders remains compatible', async () => {
    const page = await repo.paging({ pageSize: 2 }, args);
    assert.equal(page.total, 7);
    assert.equal(page.items.length, 2);
  });
  const equal = (field, data) => ({ field, operator: 'EQUAL', data });
  await check('nested AND/OR filters through public paging API remain conjunctive with scope', async () => {
    const filters = [
      {
        operator: 'AND',
        data: [
          { operator: 'OR', data: [equal('code', 'R1'), equal('code', 'R2'), equal('code', 'R8'), equal('code', 'R9')] },
          { field: 'displayName', operator: 'NOT_EQUAL', data: 'Alpha' },
        ],
      },
    ];
    const page = await repo.paging({ filters, orders: [{ field: 'id', direction: 'ASC' }], pageSize: 2 }, args);
    assert.deepEqual(ids(page), [1]);
    assert.equal(page.total, 1);
  });
  await check('mapped joined filter and sort', async () => {
    const page = await repo.paging(
      { filters: [equal('parentLink.displayName', 'Alpha')], orders: [{ field: 'displayName', direction: 'ASC' }], pageSize: 1 },
      args,
    );
    assert.deepEqual(ids(page), [3]);
    assert.equal(page.total, 2);
  });
  await check('empty result keeps total zero', async () => {
    const page = await repo.paging({ filters: [equal('code', 'absent')], orders: [{ field: 'id', direction: 'ASC' }] }, args);
    assert.deepEqual(page, { items: [], total: 0 });
  });
  await check('root tenant/unit and camelCase/nested relation isolation', async () => {
    const page = await repo.paging({ pageSize: 20, orders: [{ field: 'id', direction: 'ASC' }] }, args);
    assert.deepEqual(ids(page), [1, 2, 3, 4, 5, 6, 7]);
    assert.equal(page.items[4].parentLink, null);
    assert.equal(page.items[5].parentLink, null);
    assert.equal(page.items[6].parentLink.relatedChild, null);
    assert.equal(page.items[0].parentLink.relatedChild.id, uid(101));
    assert.equal(page.items[0].sibling_link.id, uid(201));
    assert.ok(page.items.every((item) => item.tenantId === 'A' && item.unitId === 'U1'));
  });
  await check('select:false fields remain absent in root and joined projections', async () => {
    const page = await repo.paging({ pageSize: 20, orders: [{ field: 'id', direction: 'ASC' }] }, args);
    for (const item of page.items) {
      for (const projected of [item, item.parentLink, item.sibling_link, item.parentLink?.relatedChild]) {
        if (projected) assert.equal(Object.hasOwn(projected, 'privateValue'), false);
      }
    }
  });
  await check('array tenant scope preserves relation alias escaping', async () => {
    const arrayRepo = new Repository(Item, ds, { tenancyStrategy: strategy({ tenantId: ['A'], unitId: ['U1'] }) });
    const page = await arrayRepo.paging(
      {
        pageSize: 2,
        orders: [
          { field: 'parentLink.relatedChild.displayName', direction: 'DESC' },
          { field: 'id', direction: 'ASC' },
        ],
      },
      args,
    );
    assert.deepEqual(ids(page), [2, 1]);
    assert.equal(page.total, 7);
  });
  await check('empty unit scope fails closed', async () => {
    const empty = new Repository(Item, ds, { tenancyStrategy: strategy({ tenantId: 'A', unitId: [] }) });
    assert.deepEqual(await empty.paging({ orders: [{ field: 'id', direction: 'ASC' }] }, args), { items: [], total: 0 });
  });
  await check('missing trusted context and required scope reject before SQL', async () => {
    for (const options of [undefined, { tenancyStrategy: strategy({ tenantId: 'A' }) }]) {
      queries.length = 0;
      await assert.rejects(
        () => new Repository(Item, ds, options).paging({ orders: [{ field: 'id', direction: 'ASC' }] }, args),
        /scope|context/i,
      );
      assert.equal(queries.length, 0);
    }
  });
  for (const field of [
    'missing',
    'display_name',
    'parentLink.missing',
    'parentLink.relatedChild.missing',
    'parentLink.noSuch.name',
    'id; DROP TABLE item',
    'parentLink."code"',
    '__proto__.name',
  ]) {
    await check('invalid sort field rejects before SQL: ' + field, async () => {
      queries.length = 0;
      await assert.rejects(() => repo.paging({ orders: [{ field, direction: 'ASC' }] }, args));
      assert.equal(queries.length, 0);
    });
  }
  for (const direction of ['SIDEWAYS', 'ASC; DROP TABLE item']) {
    await check('invalid direction rejects before SQL: ' + direction, async () => {
      queries.length = 0;
      await assert.rejects(() => repo.paging({ orders: [{ field: 'id', direction }] }, args));
      assert.equal(queries.length, 0);
    });
  }
  for (const filter of [
    { field: 'code', operator: 'EXECUTE', data: 'R1' },
    { field: 'code; DROP TABLE item', operator: 'EQUAL', data: 'R1' },
    { field: 'code', operator: 'IN', data: 'not-an-array' },
    { operator: 'AND', data: 'not-an-array' },
  ]) {
    await check('invalid filter rejects before SQL: ' + JSON.stringify(filter), async () => {
      queries.length = 0;
      await assert.rejects(() => repo.paging({ filters: [filter] }, args));
      assert.equal(queries.length, 0);
    });
  }
  await check('value injection is bound as data and cannot widen scope', async () => {
    const injection = "' OR 1=1; DROP TABLE item; --";
    queries.length = 0;
    const page = await repo.paging({ filters: [equal('code', injection)], orders: [{ field: 'id', direction: 'ASC' }] }, args);
    assert.deepEqual(page, { items: [], total: 0 });
    assert.ok(queries.some((q) => q.parameters?.includes(injection)));
    assert.ok(queries.every((q) => !q.query.includes(injection)));
  });
  await check('all rows unchanged after invalid and injection requests', async () => {
    assert.deepEqual(await snapshot(), before);
  });
  console.log(
    JSON.stringify({
      format,
      status: 'passed',
      database: 'owned disposable PostgreSQL',
      postgresVersion,
      typeormVersion,
      nodeVersion: process.version,
      cases,
      count: cases.length,
    }),
  );
} catch (error) {
  // Never print the connection URL, credentials, query parameters or raw driver object.
  console.error(
    JSON.stringify({
      format,
      status: 'failed',
      cases,
      error: { name: error.name, message: error.message.replaceAll(url.password, '[redacted]') },
    }),
  );
  process.exitCode = 1;
} finally {
  if (schemaCreated) {
    assert.match(schema, /^core_paging_[a-f0-9]{32}$/);
    await ds.query('DROP SCHEMA "' + schema + '" CASCADE');
  }
  if (ds.isInitialized) await ds.destroy();
}
