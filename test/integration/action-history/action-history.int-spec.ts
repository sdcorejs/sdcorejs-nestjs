import 'reflect-metadata';
import { NotFoundException } from '@nestjs/common';
import { Column, type DataSource, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { ContextService } from '../../../src/core/context/context.service';
import { BaseRepository } from '../../../src/core/orm/base-repository';
import { Scoped } from '../../../src/core/orm/decorators/scoped.decorator';
import type { ITenancyStrategy, TenancyBypassGrant } from '../../../src/core/tenancy/strategy.interface';
import { ActionHistory } from '../../../src/features/action-history/action-history.entity';
import { ActionHistoryService, MissingActionHistoryTenantError } from '../../../src/features/action-history/action-history.service';
import { ActionHistoryType } from '../../../src/features/action-history/types';
import { createTestDataSource } from '../../fixtures/pg-mem-datasource';

const RESOURCE_ID = '00000000-0000-4000-a000-000000000001';
const USER_A1 = '00000000-0000-4000-a000-000000000011';
const USER_A2 = '00000000-0000-4000-a000-000000000012';
const USER_B1 = '00000000-0000-4000-a000-000000000021';

@Entity('audited_resource')
class AuditedResource {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'varchar' }) name!: string;
  @Column({ type: 'varchar', select: false }) @Scoped() tenantCode!: string;
}

class AuditedResourceRepository extends BaseRepository<AuditedResource> {
  constructor(dataSource: DataSource, context: ContextService, historyRecorder: ActionHistoryService, grant: TenancyBypassGrant) {
    const tenancyStrategy: ITenancyStrategy = {
      getCurrentScope: () => ({ tenantCode: 'TENANT-A' }),
      shouldBypass: () => false,
      getBypassGrant: () => grant,
    };
    super(AuditedResource, dataSource, { contextService: context, tenancyStrategy, historyRecorder, logHistory: true });
  }
}

describe('ActionHistoryService tenant and authorization isolation (pg-mem)', () => {
  let dataSource: DataSource;
  let context: ContextService;
  let service: ActionHistoryService;

  beforeEach(async () => {
    dataSource = await createTestDataSource([ActionHistory, AuditedResource]);
    context = new ContextService();
    service = new ActionHistoryService(dataSource.getRepository(ActionHistory), context, undefined, {
      authorizeRead: ({ context: current }) => current.userId === USER_A1,
      maxPageSize: 2,
    });
  });

  afterEach(async () => {
    await dataSource.destroy();
  });

  it('scopes reads by tenant, resource type and resource id', async () => {
    await context.run({ tenant: 'TENANT-A', userId: USER_A1 }, () =>
      service.create({ table: 'deal', tableId: RESOURCE_ID, type: ActionHistoryType.CREATE, toData: { name: 'A' } }),
    );
    await context.run({ tenant: 'TENANT-A', userId: USER_A1 }, () =>
      service.create({ table: 'invoice', tableId: RESOURCE_ID, type: ActionHistoryType.CREATE, toData: { name: 'invoice' } }),
    );
    await context.run({ tenant: 'TENANT-B', userId: USER_B1 }, () =>
      service.create({ table: 'deal', tableId: RESOURCE_ID, type: ActionHistoryType.CREATE, toData: { name: 'B' } }),
    );

    const page = await context.run({ tenant: 'TENANT-A', userId: USER_A1 }, () => service.all({ table: 'deal', tableId: RESOURCE_ID }));
    expect(page.total).toBe(1);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ tenantCode: 'TENANT-A', table: 'deal', tableId: RESOURCE_ID });
  });

  it('returns a non-enumerating 404 to an unauthorized same-tenant user', async () => {
    await context.run({ tenant: 'TENANT-A', userId: USER_A1 }, () =>
      service.create({ table: 'deal', tableId: RESOURCE_ID, type: ActionHistoryType.CREATE }),
    );
    await expect(
      context.run({ tenant: 'TENANT-A', userId: USER_A2 }, () => service.all({ table: 'deal', tableId: RESOURCE_ID })),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns the same 404 for a malformed resource id before PostgreSQL UUID coercion', async () => {
    await expect(
      context.run({ tenant: 'TENANT-A', userId: USER_A1 }, () => service.all({ table: 'deal', tableId: 'not-a-uuid' })),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('redacts nested secrets before persistence and enforces the page-size ceiling', async () => {
    for (let index = 0; index < 3; index += 1) {
      await context.run({ tenant: 'TENANT-A', userId: USER_A1 }, () =>
        service.create({
          table: 'deal',
          tableId: RESOURCE_ID,
          type: ActionHistoryType.UPDATE,
          toData: { index, password: `secret-${index}`, auth: { refreshToken: `token-${index}` } },
        }),
      );
    }

    const page = await context.run({ tenant: 'TENANT-A', userId: USER_A1 }, () =>
      service.all<{ index: number; password: string; auth: { refreshToken: string } }>({
        table: 'deal',
        tableId: RESOURCE_ID,
        pageSize: 1000,
      }),
    );
    expect(page.total).toBe(3);
    expect(page.items).toHaveLength(2);
    expect(page.items[0].toData).toMatchObject({ password: '[REDACTED]', auth: { refreshToken: '[REDACTED]' } });
  });

  it('refuses to write a tenantless audit row', async () => {
    await expect(
      context.run({ userId: USER_A1 }, () => service.create({ table: 'deal', tableId: RESOURCE_ID, type: ActionHistoryType.CREATE })),
    ).rejects.toBeInstanceOf(MissingActionHistoryTenantError);
  });

  it('attributes a bypassed cross-tenant mutation to the persisted resource tenant', async () => {
    const resource = await dataSource.getRepository(AuditedResource).save({ name: 'before', tenantCode: 'TENANT-B' });
    const grant: TenancyBypassGrant = {
      authorized: true,
      actorId: USER_A1,
      reason: 'approved support update',
      allowedTargets: ['audited_resource'],
      allowedOperations: ['update'],
      audit: jest.fn(),
    };
    const repository = new AuditedResourceRepository(dataSource, context, service, grant);

    await context.run({ tenant: 'TENANT-A', userId: USER_A1 }, () => repository.update({ id: resource.id, name: 'after' }));

    const history = await dataSource.getRepository(ActionHistory).findOneByOrFail({ tableId: resource.id });
    expect(history).toMatchObject({ tenantCode: 'TENANT-B', table: 'audited_resource' });
    expect(history.toData).toMatchObject({ name: 'after' });

    const fromTenantA = await context.run({ tenant: 'TENANT-A', userId: USER_A1 }, () =>
      service.all({ table: 'audited_resource', tableId: resource.id }),
    );
    expect(fromTenantA.total).toBe(0);
    const fromTenantB = await context.run({ tenant: 'TENANT-B', userId: USER_A1 }, () =>
      service.all({ table: 'audited_resource', tableId: resource.id }),
    );
    expect(fromTenantB.total).toBe(1);
  });
});
