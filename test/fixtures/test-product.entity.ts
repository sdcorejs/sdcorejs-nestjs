import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../../src/core/orm/base-entity';
import { WithAudit } from '../../src/core/orm/mixins';
import { SearchableFields } from '../../src/core/orm/decorators/searchable-fields.decorator';

@SearchableFields({ exact: ['code'], contain: ['name'], activeColumn: 'isActive' })
@Entity('test_product')
export class TestProduct extends WithAudit(BaseEntity) {
  @Column({ nullable: true })
  code?: string;

  @Column({ nullable: true })
  name?: string;

  @Column({ nullable: true, type: 'integer' })
  price?: number;

  @Column({ type: 'jsonb', nullable: true })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  attributes?: Record<string, any>;

  @Column({ nullable: true, default: true })
  isActive?: boolean;
}
