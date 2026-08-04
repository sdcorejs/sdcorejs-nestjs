import 'reflect-metadata';
import { DataType, newDb } from 'pg-mem';
import type { DataSource } from 'typeorm';
import { UploadedFileDirectLifecycle1785744000000 } from './migrations';

describe('UploadedFileDirectLifecycle1785744000000', () => {
  let dataSource: DataSource;

  beforeEach(async () => {
    const database = newDb();
    database.public.registerFunction({
      name: 'version',
      args: [],
      returns: DataType.text,
      implementation: () => 'PostgreSQL 14.0 (pg-mem)',
    });
    database.public.registerFunction({
      name: 'current_database',
      args: [],
      returns: DataType.text,
      implementation: () => 'pg-mem',
    });
    dataSource = database.adapters.createTypeormDataSource({ type: 'postgres', entities: [] });
    await dataSource.initialize();
    await dataSource.query(`
      CREATE TABLE "uploaded_file" (
        "id" uuid PRIMARY KEY,
        "tenantCode" varchar(64) NOT NULL,
        "departmentCode" varchar(64),
        "userId" uuid NOT NULL,
        "fileSize" double precision,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await dataSource.query(`INSERT INTO "uploaded_file" ("id", "tenantCode", "userId", "fileSize") VALUES ($1, $2, $3, $4)`, [
      '00000000-0000-4000-8000-000000000001',
      'tenant-a',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      1.5,
    ]);
  });

  afterEach(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  it('applies additive columns/indexes and a conservative legacy backfill, then rolls them back', async () => {
    const migration = new UploadedFileDirectLifecycle1785744000000();
    const statements: string[] = [];
    const runner = {
      query: async (statement: string) => {
        statements.push(statement);
        return dataSource.query(statement);
      },
    };
    await migration.up(runner as never);

    const [row] = (await dataSource.query(
      `SELECT "visibility", "status", "isTemporary", "disposition", "sizeBytes", "completedAt" FROM "uploaded_file"`,
    )) as Array<Record<string, unknown>>;
    expect(row).toEqual({
      visibility: 'private',
      status: 'ready',
      isTemporary: false,
      disposition: 'attachment',
      sizeBytes: null,
      completedAt: null,
    });
    expect(statements.filter((statement) => statement.startsWith('CREATE INDEX'))).toEqual([
      expect.stringContaining('IDX_uploaded_file_pending_cleanup'),
      expect.stringContaining('IDX_uploaded_file_temporary_cleanup'),
      expect.stringContaining('IDX_uploaded_file_tenant_owner_status'),
    ]);

    await migration.down(runner as never);
    const columns = (await dataSource.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'uploaded_file'`,
    )) as Array<{ column_name: string }>;
    expect(columns.map(({ column_name }) => column_name)).not.toContain('visibility');
    expect(columns.map(({ column_name }) => column_name)).not.toContain('pendingKey');
  });
});
