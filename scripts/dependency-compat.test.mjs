import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { importClassesFromDirectories, importJsonsFromDirectories } = require('typeorm/util/DirectoryExportedClassesLoader');

test('TypeORM 0.3 discovers CJS/ESM entities and JSON through the patched glob dependency', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'core-glob-compat-'));
  try {
    mkdirSync(path.join(dir, 'nested'));
    writeFileSync(path.join(dir, 'entity.cjs'), 'module.exports = class CjsEntity {};');
    writeFileSync(path.join(dir, 'nested', 'migration.mjs'), 'export class EsmMigration {}');
    writeFileSync(path.join(dir, 'entity.d.ts'), 'export declare class IgnoredDeclaration {}');
    writeFileSync(path.join(dir, 'schema.json'), '{"name":"synthetic-schema"}');
    const glob = dir.replaceAll('\\', '/') + '/**/*.{cjs,mjs}';
    const classes = await importClassesFromDirectories({ log() {} }, [glob]);
    assert.deepEqual(classes.map((value) => value.name).sort(), ['CjsEntity', 'EsmMigration']);
    assert.deepEqual(importJsonsFromDirectories([dir.replaceAll('\\', '/') + '/**/*.json']), [{ name: 'synthetic-schema' }]);
    assert.deepEqual(await importClassesFromDirectories({ log() {} }, [dir.replaceAll('\\', '/') + '/missing/*.js']), []);
  } finally {
    assert.equal(path.dirname(realpathSync(dir)), realpathSync(os.tmpdir()));
    rmSync(dir, { recursive: true, force: true });
  }
});
