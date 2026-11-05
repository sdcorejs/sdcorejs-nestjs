import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { Test } from '@nestjs/testing';
import 'reflect-metadata';

const app = createRequire(import.meta.url);
const library = createRequire(app.resolve('@sdcorejs/nestjs'));
const nestOrm = createRequire(app.resolve('@nestjs/typeorm'));
for (const name of ['DataSource', 'EntityManager', 'Repository', 'EntitySchema']) {
  assert.equal(app('typeorm')[name], library('typeorm')[name], `${name}: application/library identity`);
  assert.equal(app('typeorm')[name], nestOrm('typeorm')[name], `${name}: application/Nest ORM identity`);
}
for (const name of ['@nestjs/common', '@nestjs/core', '@nestjs/platform-express']) {
  assert.equal(app(name), library(name), `${name}: application/library identity`);
}
const { DataSource, EntityManager, EntitySchema, Repository } = app('typeorm');
const { getDataSourceToken, getEntityManagerToken, getRepositoryToken } = app('@nestjs/typeorm');
assert.equal(getDataSourceToken(), DataSource);
assert.equal(getEntityManagerToken(), EntityManager);
assert.equal(getRepositoryToken(new EntitySchema({ name: 'SharedEntity', columns: {} })), 'SharedEntityRepository');
class CustomRepository extends Repository {}
assert.equal(getRepositoryToken(CustomRepository), CustomRepository);
const dataSource = {};
const manager = {};
const moduleRef = await Test.createTestingModule({
  providers: [{ provide: DataSource, useValue: dataSource }, { provide: EntityManager, useValue: manager }],
}).compile();
try {
  assert.equal(moduleRef.get(getDataSourceToken()), dataSource);
  assert.equal(moduleRef.get(getEntityManagerToken()), manager);
} finally { await moduleRef.close(); }
const typeorm = JSON.parse(fs.readFileSync(path.join(path.dirname(app.resolve('typeorm')), 'package.json')));
const platform = app('@nestjs/platform-express/package.json');
assert.equal(typeorm.sdcorejsBackport?.dependencies.glob, '14.0.3');
assert.equal(platform.sdcorejsBackport?.dependencies.multer, '2.5.0');
assert.equal(nestOrm('typeorm/util/DirectoryExportedClassesLoader').importClassesFromDirectories instanceof Function, true);
console.log('PASS: shared application/library/Nest class and DI identities; reviewed backports installed');
