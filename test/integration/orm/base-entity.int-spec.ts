import 'reflect-metadata';
import { Column, Entity, type DataSource } from 'typeorm';
import { BaseEntity } from '../../../src/core/orm/base-entity';
import { WithTimestamps, WithAudit, isAuditEnabled } from '../../../src/core/orm/mixins';
import type { ClassRef } from '../../../src/core/orm/types/class-ref.types';
import { createTestDataSource } from '../../fixtures/pg-mem-datasource';

@Entity('plain_test')
class PlainEntity extends BaseEntity {
  @Column()
  name!: string;
}

@Entity('timestamped_test')
class TimestampedEntity extends WithTimestamps(BaseEntity) {
  @Column()
  name!: string;
}

@Entity('audited_test')
class AuditedEntity extends WithAudit(BaseEntity) {
  @Column()
  name!: string;
}

describe('BaseEntity + mixins (TypeORM metadata)', () => {
  let ds: DataSource;

  beforeAll(async () => {
    ds = await createTestDataSource([PlainEntity, TimestampedEntity, AuditedEntity]);
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  const cols = (ctor: ClassRef): string[] =>
    ds
      .getMetadata(ctor)
      .columns.map((c) => c.propertyName)
      .sort();

  it('BaseEntity contributes only `id`', () => {
    expect(cols(PlainEntity)).toEqual(['id', 'name']);
  });

  it('WithTimestamps adds createdAt + updatedAt + deletedAt', () => {
    expect(cols(TimestampedEntity)).toEqual(['createdAt', 'deletedAt', 'id', 'name', 'updatedAt']);
  });

  it('WithAudit adds timestamps + createdBy/modifiedBy/creator/modifier', () => {
    expect(cols(AuditedEntity)).toEqual(
      ['createdAt', 'createdBy', 'creator', 'deletedAt', 'id', 'modifiedBy', 'modifier', 'name', 'updatedAt'].sort(),
    );
  });

  it('id column is uuid + auto-generated', () => {
    const idCol = ds.getMetadata(PlainEntity).columns.find((c) => c.propertyName === 'id');
    expect(idCol?.type).toBe('uuid');
    expect(idCol?.isGenerated).toBe(true);
  });

  it('isAuditEnabled returns true for WithAudit entity', () => {
    expect(isAuditEnabled(AuditedEntity)).toBe(true);
  });

  it('isAuditEnabled returns false for WithTimestamps-only entity', () => {
    expect(isAuditEnabled(TimestampedEntity)).toBe(false);
  });

  it('isAuditEnabled returns false for plain BaseEntity', () => {
    expect(isAuditEnabled(PlainEntity)).toBe(false);
  });

  it('isAuditEnabled returns false for undefined', () => {
    expect(isAuditEnabled(undefined)).toBe(false);
  });

  it('save() generates UUID into id when inserted', async () => {
    const repo = ds.getRepository(PlainEntity);
    const entity = repo.create({ name: 'test' });
    const saved = await repo.save(entity);
    expect(saved.id).toBeDefined();
    expect(typeof saved.id).toBe('string');
    expect(saved.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });
});
