import { newDb, DataType } from 'pg-mem';
import type { DataSource, EntitySchema, MixedList } from 'typeorm';

/* eslint-disable @typescript-eslint/no-explicit-any */
type EntityClass = abstract new (...args: any[]) => any;
type EntityListItem = EntityClass | string | EntitySchema<any>;

/**
 * Build a pg-mem-backed TypeORM DataSource for integration tests.
 * Registers `uuid_generate_v4` and a no-op `unaccent` function so default operators
 * used by `BaseRepository` resolve under pg-mem.
 */
export async function createTestDataSource(entities: MixedList<EntityListItem>): Promise<DataSource> {
  const db = newDb({ autoCreateForeignKeyIndices: true });

  db.public.registerFunction({
    name: 'version',
    args: [],
    returns: DataType.text,
    implementation: () => 'PostgreSQL 14.0 (pg-mem)',
  });

  db.public.registerFunction({
    name: 'current_database',
    args: [],
    returns: DataType.text,
    implementation: () => 'pg-mem',
  });

  db.public.registerFunction({
    name: 'uuid_generate_v4',
    returns: DataType.uuid,
    implementation: () => globalThis.crypto.randomUUID(),
    impure: true,
  });

  db.public.registerFunction({
    name: 'unaccent',
    args: [DataType.text],
    returns: DataType.text,
    implementation: (s: string) => s ?? '',
  });

  db.public.registerFunction({
    name: 'obj_description',
    args: [DataType.regclass, DataType.text],
    returns: DataType.text,
    implementation: () => '',
  });

  const ds = db.adapters.createTypeormDataSource({
    type: 'postgres',
    entities,
    synchronize: true,
  }) as DataSource;
  await ds.initialize();
  return ds;
}
