import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  AUDIT_STRATEGY,
  BaseRepository,
  ContextService,
  TENANCY_STRATEGY,
  type IAuditStrategy,
  type ITenancyStrategy,
} from '@sdcorejs/nestjs/core';
import { Product } from './product.entity';

@Injectable()
export class ProductRepository extends BaseRepository<Product> {
  constructor(
    @InjectDataSource() dataSource: DataSource,
    context: ContextService,
    @Inject(TENANCY_STRATEGY) tenancy: ITenancyStrategy,
    @Inject(AUDIT_STRATEGY) audit: IAuditStrategy,
  ) {
    super(Product, dataSource, {
      contextService: context,
      tenancyStrategy: tenancy,
      auditStrategy: audit,
      logHistory: true,
    });
  }
}
