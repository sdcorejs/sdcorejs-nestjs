import 'reflect-metadata';
import { Controller, Injectable, Module, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Column, DataSource, Entity } from 'typeorm';
import { SdCoreModule } from '../../src/sd-core.module';
import { BaseEntity } from '../../src/core/orm/base-entity';
import { WithAudit } from '../../src/core/orm/mixins';
import { BaseRepository } from '../../src/core/orm/base-repository';
import { BaseService } from '../../src/core/orm/base-service';
import { BaseController } from '../../src/core/orm/base-controller';
import { Scoped } from '../../src/core/orm/decorators/scoped.decorator';
import { SearchableFields } from '../../src/core/orm/decorators/searchable-fields.decorator';
import { ContextService } from '../../src/core/context/context.service';
import { TENANCY_STRATEGY } from '../../src/core/tenancy/tokens';
import { AUDIT_STRATEGY } from '../../src/core/audit/tokens';
import { PERMISSION_STRATEGY } from '../../src/auth/permission/tokens';
import { SampleAuditStrategy, SamplePermissionStrategy, SampleTenancyStrategy } from '../fixtures/sample-strategies';
import { createTestDataSource } from '../fixtures/pg-mem-datasource';

@SearchableFields({ exact: ['code'], contain: ['name'], activeColumn: 'isActive' })
@Entity('e2e_product')
class E2eProduct extends WithAudit(BaseEntity) {
  @Column() name!: string;
  @Column({ nullable: true }) code?: string;
  @Column({ default: true, nullable: true }) isActive?: boolean;
  @Column() @Scoped() tenantCode!: string;
}

interface E2eProductDto {
  id: string;
  name: string;
  code?: string;
  tenantCode: string;
  createdBy?: string;
  deletable?: boolean;
  restorable?: boolean;
}

@Injectable()
class E2eProductRepository extends BaseRepository<E2eProduct> {
  constructor(
    ds: DataSource,
    ctx: ContextService,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    @(Reflect.metadata('design:type', Object) as never) ts: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    as: any,
  ) {
    super(E2eProduct, ds, { contextService: ctx, tenancyStrategy: ts, auditStrategy: as });
  }
}

@Injectable()
class E2eProductService extends BaseService<E2eProduct, E2eProductDto> {
  mapDTO(e: E2eProduct | undefined | null): E2eProductDto | null {
    if (!e) return null;
    return {
      id: e.id,
      name: e.name,
      code: e.code,
      tenantCode: e.tenantCode,
      createdBy: e.createdBy ?? undefined,
      deletable: true,
      restorable: true,
    };
  }
}

@Controller('products')
class E2eProductController extends BaseController<E2eProduct, E2eProductDto> {
  constructor(svc: E2eProductService) {
    super(svc);
  }
}

describe('Consumer-app E2E — full SdCoreModule.forRoot() integration', () => {
  let app: INestApplication;
  let ds: DataSource;

  beforeAll(async () => {
    ds = await createTestDataSource([E2eProduct]);
    // Seed: two tenants, two rows each
    await ds.getRepository(E2eProduct).save([
      { name: 'Acme phone', code: 'A-100', tenantCode: 'ACME' },
      { name: 'Acme laptop', code: 'A-200', tenantCode: 'ACME' },
      { name: 'Beta phone', code: 'B-100', tenantCode: 'BETA' },
    ]);

    @Module({
      imports: [
        SdCoreModule.forRoot({
          tenancy: { strategy: SampleTenancyStrategy },
          audit: { strategy: SampleAuditStrategy },
          permission: { strategy: SamplePermissionStrategy },
        }),
      ],
      controllers: [E2eProductController],
      providers: [
        { provide: DataSource, useValue: ds },
        {
          provide: E2eProductRepository,
          inject: [DataSource, ContextService, TENANCY_STRATEGY, AUDIT_STRATEGY],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          useFactory: (d: DataSource, c: ContextService, t: any, a: any) => new E2eProductRepository(d, c, t, a),
        },
        {
          provide: E2eProductService,
          inject: [E2eProductRepository],
          useFactory: (r: E2eProductRepository) => new E2eProductService(r),
        },
        { provide: PERMISSION_STRATEGY, useClass: SamplePermissionStrategy },
      ],
    })
    class TestModule {}

    const mod = await Test.createTestingModule({ imports: [TestModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await ds?.destroy();
  });

  it('paging scoped to tenant ACME via X-Tenant header (mapped to entity tenantCode column)', async () => {
    const res = await request(app.getHttpServer())
      .post('/products/paging')
      .set('X-Tenant', 'ACME')
      .set('X-User-Id', '00000000-0000-4000-a000-000000000001')
      .send({ pageNumber: 0, pageSize: 10 });
    expect(res.status).toBe(201);
    expect(res.body.data.total).toBe(2);
    expect(res.body.data.items.every((p: { tenantCode: string }) => p.tenantCode === 'ACME')).toBe(true);
  });

  it('paging scoped to tenant BETA returns only BETA rows', async () => {
    const res = await request(app.getHttpServer()).post('/products/paging').set('X-Tenant', 'BETA').send({ pageNumber: 0, pageSize: 10 });
    expect(res.status).toBe(201);
    expect(res.body.data.total).toBe(1);
  });
});
