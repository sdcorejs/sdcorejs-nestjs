import 'reflect-metadata';
import { BaseService } from './base-service';
import type { IBaseRepository } from './base-repository.interface';
import { Schema, SchemaProp } from './decorators/schema.decorator';
import type { Dto } from './types/dto.types';

interface RawEntity {
  id: string;
  name: string;
  active?: boolean;
}

interface RawDto extends Dto {
  id: string;
  name: string;
  deletable?: boolean;
  restorable?: boolean;
}

@Schema({ name: 'Raw', description: 'desc' })
class RawEntityClass implements RawEntity {
  @SchemaProp({ label: 'Tên', required: true })
  name!: string;
  id!: string;
  active?: boolean;
}

const makeMockRepo = (entities: RawEntity[]): IBaseRepository<RawEntity> => {
  const finder = {
    find: jest.fn(async ({ where }: { where: { id: { _value: string[] } } }) => {
      const ids = where.id._value ?? [];
      return entities.filter((e) => ids.includes(e.id));
    }),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const repo: any = {
    target: RawEntityClass,
    repository: finder,
    paging: jest.fn(async () => ({ items: entities, total: entities.length })),
    pagingDeleted: jest.fn(async () => ({ items: entities, total: entities.length })),
    all: jest.fn(async () => entities),
    search: jest.fn(async () => entities),
    detail: jest.fn(async (id: string) => entities.find((e) => e.id === id) ?? null),
    create: jest.fn(async (e: Partial<RawEntity>) => e as RawEntity),
    import: jest.fn(async (es: Partial<RawEntity>[]) => es as RawEntity[]),
    update: jest.fn(async (e: Partial<RawEntity>) => e as RawEntity),
    delete: jest.fn(async () => true),
    softDelete: jest.fn(async () => true),
    restore: jest.fn(async () => true),
  };
  return repo;
};

class RawService extends BaseService<RawEntity, RawDto> {
  mapDTO(e: RawEntity | undefined | null): RawDto | undefined | null {
    if (!e) return null;
    return { id: e.id, name: e.name, deletable: e.active === true, restorable: e.active === false };
  }
}

// Patch In() helper because mock filters don't actually use TypeORM In — store raw shape.
jest.mock('typeorm', () => ({
  ...jest.requireActual('typeorm'),
  In: (vals: string[]) => ({ _value: vals }),
}));

describe('BaseService', () => {
  it('paging maps entities to DTOs', async () => {
    const repo = makeMockRepo([{ id: '1', name: 'A' }, { id: '2', name: 'B' }]);
    const svc = new RawService(repo);
    const res = await svc.paging({ pageNumber: 0, pageSize: 10 });
    expect(res.items).toHaveLength(2);
    expect(res.items[0].name).toBe('A');
  });

  it('all + search proxy through and map', async () => {
    const repo = makeMockRepo([{ id: '1', name: 'X' }]);
    const svc = new RawService(repo);
    expect(await svc.all()).toHaveLength(1);
    expect(await svc.search('x')).toHaveLength(1);
  });

  it('detail returns null when entity missing', async () => {
    const repo = makeMockRepo([]);
    const svc = new RawService(repo);
    expect(await svc.detail('missing')).toBeNull();
  });

  it('update fetches first then delegates with merged id', async () => {
    const repo = makeMockRepo([{ id: '1', name: 'old' }]);
    const svc = new RawService(repo);
    await svc.update('1', { name: 'new' });
    expect(repo.detail).toHaveBeenCalledWith('1');
    expect(repo.update).toHaveBeenCalledWith({ id: '1', name: 'new' }, undefined);
  });

  it('delete filters dtos by deletable=true', async () => {
    const repo = makeMockRepo([
      { id: '1', name: 'a', active: true },
      { id: '2', name: 'b', active: false },
    ]);
    const svc = new RawService(repo);
    const removed = await svc.delete('1,2');
    expect(removed).toHaveLength(1);
    expect(removed[0].id).toBe('1');
    expect(repo.delete).toHaveBeenCalledWith(['1']);
  });

  it('restore filters dtos by restorable=true', async () => {
    const repo = makeMockRepo([
      { id: '1', name: 'a', active: true },
      { id: '2', name: 'b', active: false },
    ]);
    const svc = new RawService(repo);
    const restored = await svc.restore('1,2');
    expect(restored).toHaveLength(1);
    expect(restored[0].id).toBe('2');
  });

  it('schema() reads @Schema + @SchemaProp metadata', () => {
    const repo = makeMockRepo([]);
    const svc = new RawService(repo);
    const { schema, props, fields } = svc.schema();
    expect(schema.name).toBe('Raw');
    expect(props.name?.label).toBe('Tên');
    expect(fields).toContain('name');
  });
});
