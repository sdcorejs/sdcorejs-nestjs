import 'reflect-metadata';
import { BaseRepository, type BaseRepositoryOptions } from './base-repository';
import { type HistoryEntry, type IHistoryRecorder, registerHistoryRecorder } from './history';

class TestEntity {
  id!: string;
  name!: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeRepoMock(): any {
  return {
    metadata: { tableName: 'test_table' },
    create: jest.fn((e: unknown) => e),
    save: jest.fn(async (e: { id?: string }) => ({ id: e.id ?? 'new-id', ...e })),
    findOne: jest.fn(async () => ({ id: 'id1', name: 'old' })),
    find: jest.fn(async () => [
      { id: 'id1', name: 'o1' },
      { id: 'id2', name: 'o2' },
    ]),
    delete: jest.fn(async () => ({ affected: 2 })),
  };
}

class TestRepo extends BaseRepository<TestEntity> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(ds: any, options?: BaseRepositoryOptions) {
    super(TestEntity, ds, options);
  }
}

describe('BaseRepository history hook', () => {
  let repoMock: ReturnType<typeof makeRepoMock>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ds: any;
  let recorder: { record: jest.Mock };

  beforeEach(() => {
    repoMock = makeRepoMock();
    ds = { getRepository: jest.fn(() => repoMock) };
    recorder = { record: jest.fn(async () => undefined) };
    // Reset the global recorder so the fallback test is deterministic.
    registerHistoryRecorder(undefined as unknown as IHistoryRecorder);
  });

  it('create emits a CREATE entry with table, new id and snapshot', async () => {
    const repo = new TestRepo(ds, { logHistory: true, historyRecorder: recorder });
    await repo.create({ name: 'a' } as Partial<TestEntity>);
    expect(recorder.record).toHaveBeenCalledTimes(1);
    const entry = recorder.record.mock.calls[0][0] as HistoryEntry;
    expect(entry).toMatchObject({ table: 'test_table', type: 'CREATE', tableId: 'new-id', fromData: null });
    expect(entry.toData).toMatchObject({ id: 'new-id', name: 'a' });
  });

  it('update fetches the old row and emits an UPDATE entry (from → to)', async () => {
    const repo = new TestRepo(ds, { logHistory: true, historyRecorder: recorder });
    await repo.update({ id: 'id1', name: 'b' } as Partial<TestEntity>);
    expect(repoMock.findOne).toHaveBeenCalled();
    const entry = recorder.record.mock.calls[0][0] as HistoryEntry;
    expect(entry).toMatchObject({ table: 'test_table', type: 'UPDATE', tableId: 'id1' });
    expect(entry.fromData).toMatchObject({ id: 'id1', name: 'old' });
    expect(entry.toData).toMatchObject({ id: 'id1', name: 'b' });
  });

  it('delete emits one DELETE entry per affected row', async () => {
    const repo = new TestRepo(ds, { logHistory: true, historyRecorder: recorder });
    const ok = await repo.delete('id1,id2');
    expect(ok).toBe(true);
    expect(recorder.record).toHaveBeenCalledTimes(2);
    expect(recorder.record.mock.calls[0][0]).toMatchObject({ type: 'DELETE', tableId: 'id1', toData: null });
    expect(recorder.record.mock.calls[1][0]).toMatchObject({ type: 'DELETE', tableId: 'id2' });
  });

  it('records nothing when logHistory is off', async () => {
    const repo = new TestRepo(ds, { historyRecorder: recorder });
    await repo.create({ name: 'a' } as Partial<TestEntity>);
    await repo.update({ id: 'id1', name: 'b' } as Partial<TestEntity>);
    expect(recorder.record).not.toHaveBeenCalled();
    expect(repoMock.findOne).not.toHaveBeenCalled();
  });

  it('falls back to the globally-registered recorder when none is passed', async () => {
    const global = { record: jest.fn(async () => undefined) };
    registerHistoryRecorder(global);
    const repo = new TestRepo(ds, { logHistory: true });
    await repo.create({ name: 'a' } as Partial<TestEntity>);
    expect(global.record).toHaveBeenCalledTimes(1);
  });
});
