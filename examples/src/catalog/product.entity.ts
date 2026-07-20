import { Column, Entity, Index } from 'typeorm';
import { BaseEntity, Scoped, WithAudit } from '@sdcorejs/nestjs/core';

// `BaseEntity` is abstract by design; a concrete app-level base lets TypeScript preserve the
// complete mixin instance type while TypeORM still sees one ordinary inheritance chain.
class ProductIdentity extends BaseEntity {}

@Entity('product')
@Index('UX_product_tenant_sku', ['tenantCode', 'sku'], { unique: true })
export class Product extends WithAudit(ProductIdentity) {
  @Scoped()
  @Column({ type: 'varchar', length: 64, update: false })
  tenantCode!: string;

  @Column({ type: 'varchar', length: 64 })
  sku!: string;

  @Column({ type: 'varchar', length: 256 })
  name!: string;

  @Column({ type: 'integer' })
  priceCents!: number;
}
