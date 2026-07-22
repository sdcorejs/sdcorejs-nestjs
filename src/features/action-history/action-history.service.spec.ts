import 'reflect-metadata';
import { NotFoundException } from '@nestjs/common';
import type { ContextService } from '../../core/context/context.service';
import type { HistoryEntry } from '../../core/orm/history';
import {
  ActionHistoryService,
  ActionHistorySnapshotLimitError,
  ActionHistoryUnsafeSnapshotError,
  MissingActionHistoryResourceTenantError,
  MissingActionHistoryTenantError,
} from './action-history.service';
import { ActionHistoryType, type ActionHistorySecurityOptions } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeRepoMock(rows: any[] = []): any {
  return {
    create: jest.fn((entity: unknown) => entity),
    save: jest.fn(async (entity: unknown) => entity),
    findAndCount: jest.fn(async () => [rows, rows.length]),
  };
}

const ctx = (tenant?: string, userId?: string): ContextService =>
  ({
    tenant,
    userId,
    store: { tenant, userId },
    getCustom: jest.fn(() => undefined),
  }) as unknown as ContextService;

const allow: ActionHistorySecurityOptions = { authorizeRead: () => true };
const RESOURCE_ID = '11111111-1111-4111-8111-111111111111';

describe('ActionHistoryService', () => {
  describe('create', () => {
    it('persists trusted tenant/actor and redacts sensitive snapshots recursively', async () => {
      const repo = makeRepoMock();
      const service = new ActionHistoryService(repo, ctx('T1', 'u1'), undefined, allow);
      await service.create({
        table: 'account',
        tableId: RESOURCE_ID,
        type: ActionHistoryType.CREATE,
        toData: {
          name: 'A',
          password: 'secret-value',
          passwordHash: 'hash-value',
          secrets: ['secret-value'],
          tokens: ['token-value'],
          privateKeyPem: 'private-key-value',
          apiKeyValue: 'api-key-value',
          credentials: { user: 'admin' },
          nested: { accessToken: 'token-value' },
        },
      });
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantCode: 'T1',
          table: 'account',
          tableId: RESOURCE_ID,
          userId: 'u1',
          toData: {
            name: 'A',
            password: '[REDACTED]',
            passwordHash: '[REDACTED]',
            secrets: '[REDACTED]',
            tokens: '[REDACTED]',
            privateKeyPem: '[REDACTED]',
            apiKeyValue: '[REDACTED]',
            credentials: '[REDACTED]',
            nested: { accessToken: '[REDACTED]' },
          },
        }),
      );
      expect(repo.save).toHaveBeenCalled();
    });

    it('uses a custom actor resolver and configured redaction paths', async () => {
      const repo = makeRepoMock();
      const service = new ActionHistoryService(repo, ctx('T1', 'u1'), () => ({ userId: 'u9', username: 'bob', fullName: 'Bob B' }), {
        ...allow,
        redactFields: ['profile.ssn'],
      });
      await service.create({
        table: 'customer',
        tableId: RESOURCE_ID,
        type: ActionHistoryType.UPDATE,
        toData: { profile: { ssn: '123', city: 'Bangkok' } },
      });
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'u9',
          username: 'bob',
          fullName: 'Bob B',
          toData: { profile: { ssn: '[REDACTED]', city: 'Bangkok' } },
        }),
      );
    });

    it('applies built-in secret redaction after a custom snapshot transform', async () => {
      const repo = makeRepoMock();
      const service = new ActionHistoryService(repo, ctx('T1', 'u1'), undefined, {
        ...allow,
        redactSnapshot: () => ({ safe: 'value', passwordHash: 'reintroduced-secret' }),
      });
      await service.create({ table: 'account', tableId: RESOURCE_ID, type: ActionHistoryType.UPDATE, toData: { safe: 'original' } });
      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ toData: { safe: 'value', passwordHash: '[REDACTED]' } }));
    });

    it('writes through the query-runner repository when one is supplied', async () => {
      const repo = makeRepoMock();
      const save = jest.fn(async (entity: unknown) => entity);
      const getRepository = jest.fn(() => ({ save }));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const queryRunner: any = { manager: { getRepository } };
      const service = new ActionHistoryService(repo, ctx('T1', 'u1'), undefined, allow);
      await service.create({ table: 't', tableId: RESOURCE_ID, type: ActionHistoryType.DELETE }, queryRunner);
      expect(getRepository).toHaveBeenCalled();
      expect(save).toHaveBeenCalled();
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('fails closed when no trusted tenant context exists', async () => {
      const service = new ActionHistoryService(makeRepoMock(), ctx(undefined, 'u1'), undefined, allow);
      await expect(service.create({ table: 't', tableId: RESOURCE_ID, type: ActionHistoryType.CREATE })).rejects.toBeInstanceOf(
        MissingActionHistoryTenantError,
      );
    });

    it('rejects snapshots beyond the defensive traversal depth before persistence', async () => {
      const repo = makeRepoMock();
      const service = new ActionHistoryService(repo, ctx('T1', 'u1'), undefined, allow);
      const root: Record<string, unknown> = {};
      let cursor = root;
      for (let depth = 0; depth < 40; depth += 1) {
        cursor.child = {};
        cursor = cursor.child as Record<string, unknown>;
      }
      await expect(
        service.create({ table: 'account', tableId: RESOURCE_ID, type: ActionHistoryType.UPDATE, toData: root }),
      ).rejects.toBeInstanceOf(ActionHistorySnapshotLimitError);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it.each([
      ['too many redacted fields', () => Object.fromEntries(Array.from({ length: 10_001 }, (_, index) => [`token${index}`, 'secret']))],
      ['an oversized redacted field name', () => ({ [`token${'x'.repeat(1024 * 1024)}`]: 'secret' })],
    ])('counts %s against the snapshot budget without persisting secret values', async (_label, snapshot) => {
      const repo = makeRepoMock();
      const service = new ActionHistoryService(repo, ctx('T1', 'u1'), undefined, allow);
      await expect(
        service.create({ table: 'account', tableId: RESOURCE_ID, type: ActionHistoryType.UPDATE, toData: snapshot() }),
      ).rejects.toBeInstanceOf(ActionHistorySnapshotLimitError);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it.each(['__proto__', 'prototype', 'constructor'])('rejects the prototype-sensitive snapshot key %s', async (key) => {
      const repo = makeRepoMock();
      const service = new ActionHistoryService(repo, ctx('T1', 'u1'), undefined, allow);
      const snapshot = Object.create(null) as Record<string, unknown>;
      Object.defineProperty(snapshot, key, { enumerable: true, configurable: true, value: { polluted: true } });

      await expect(
        service.create({ table: 'account', tableId: RESOURCE_ID, type: ActionHistoryType.UPDATE, toData: snapshot }),
      ).rejects.toBeInstanceOf(ActionHistoryUnsafeSnapshotError);
      expect(repo.save).not.toHaveBeenCalled();
      expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
    });

    it('rejects enumerable accessors without invoking them', async () => {
      const repo = makeRepoMock();
      const service = new ActionHistoryService(repo, ctx('T1', 'u1'), undefined, allow);
      const getter = jest.fn(() => 'secret');
      const snapshot = {} as Record<string, unknown>;
      Object.defineProperty(snapshot, 'value', { enumerable: true, get: getter });

      await expect(
        service.create({ table: 'account', tableId: RESOURCE_ID, type: ActionHistoryType.UPDATE, toData: snapshot }),
      ).rejects.toBeInstanceOf(ActionHistoryUnsafeSnapshotError);
      expect(getter).not.toHaveBeenCalled();
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('copies own data properties into null-prototype snapshot objects', async () => {
      const repo = makeRepoMock();
      const inherited = { ignored: 'value' };
      const snapshot = Object.assign(Object.create(inherited) as Record<string, unknown>, { own: { safe: true } });
      const service = new ActionHistoryService(repo, ctx('T1', 'u1'), undefined, allow);

      await service.create({ table: 'account', tableId: RESOURCE_ID, type: ActionHistoryType.UPDATE, toData: snapshot });
      const saved = repo.create.mock.calls[0][0].toData as Record<string, unknown>;
      expect(Object.getPrototypeOf(saved)).toBeNull();
      expect(Object.keys(saved)).toEqual(['own']);
      expect(Object.getPrototypeOf(saved.own as object)).toBeNull();
    });
  });

  describe('record', () => {
    it('maps a repository HistoryEntry into a tenant-scoped create', async () => {
      const repo = makeRepoMock();
      const service = new ActionHistoryService(repo, ctx('T1', 'u1'), undefined, allow);
      const entry: HistoryEntry = { table: 'deal', tableId: 'd1', type: 'UPDATE', fromData: { x: 1 }, toData: { x: 2 } };
      await service.record(entry);
      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ tenantCode: 'T1', table: 'deal', tableId: 'd1', type: 'UPDATE' }));
    });

    it('uses persisted resource scope instead of the current tenant for a bypassed mutation', async () => {
      const repo = makeRepoMock();
      const service = new ActionHistoryService(repo, ctx('TENANT-A', 'admin'), undefined, allow);
      await service.record({
        table: 'sales.deal',
        tableId: RESOURCE_ID,
        type: 'UPDATE',
        resourceScope: { tenantCode: 'TENANT-B' },
        toData: { id: RESOURCE_ID, tenantCode: 'TENANT-B' },
      });
      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ tenantCode: 'TENANT-B', table: 'sales.deal' }));
    });

    it('requires a resolver for persisted scopes whose tenant property is application-specific', async () => {
      const service = new ActionHistoryService(makeRepoMock(), ctx('TENANT-A', 'admin'), undefined, allow);
      await expect(
        service.record({
          table: 'sales.deal',
          tableId: RESOURCE_ID,
          type: 'UPDATE',
          resourceScope: { organizationCode: 'ORG-B' },
        }),
      ).rejects.toBeInstanceOf(MissingActionHistoryResourceTenantError);
    });

    it('maps application-specific persisted scope through the configured tenant resolver', async () => {
      const repo = makeRepoMock();
      const service = new ActionHistoryService(repo, ctx('TENANT-A', 'admin'), undefined, {
        ...allow,
        resolveResourceTenant: ({ resourceScope }) => resourceScope.organizationCode as string,
      });
      await service.record({
        table: 'sales.deal',
        tableId: RESOURCE_ID,
        type: 'UPDATE',
        resourceScope: { organizationCode: 'ORG-B' },
      });
      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ tenantCode: 'ORG-B' }));
    });
  });

  describe('all', () => {
    it('queries by tenant + resource type + id with bounded pagination', async () => {
      const createdAt = new Date('2026-01-02T03:04:05.000Z');
      const repo = makeRepoMock([
        { id: 'h1', tenantCode: 'T1', table: 'deal', tableId: RESOURCE_ID, userId: 'u1', type: ActionHistoryType.CREATE, createdAt },
      ]);
      const service = new ActionHistoryService(repo, ctx('T1', 'u1'), undefined, { authorizeRead: () => true, maxPageSize: 25 });
      const page = await service.all({ table: 'deal', tableId: RESOURCE_ID, pageNumber: 2, pageSize: 999 });
      expect(repo.findAndCount).toHaveBeenCalledWith({
        where: { tenantCode: 'T1', table: 'deal', tableId: RESOURCE_ID },
        order: { createdAt: 'DESC' },
        skip: 50,
        take: 25,
      });
      expect(page).toMatchObject({ total: 1, items: [{ id: 'h1', tenantCode: 'T1', createdAt: createdAt.toISOString() }] });
    });

    it('normalizes invalid configured limits and caps huge offsets', async () => {
      const repo = makeRepoMock();
      const service = new ActionHistoryService(repo, ctx('T1', 'u1'), undefined, {
        authorizeRead: () => true,
        maxPageSize: Number.NaN,
      });
      await service.all({ table: 'deal', tableId: RESOURCE_ID, pageNumber: Number.MAX_VALUE, pageSize: Number.MAX_VALUE });
      expect(repo.findAndCount).toHaveBeenCalledWith(expect.objectContaining({ skip: 100_000, take: 100 }));
    });

    it('accepts schema-qualified resource paths through 256 characters and rejects longer values', async () => {
      const repo = makeRepoMock();
      const service = new ActionHistoryService(repo, ctx('T1', 'u1'), undefined, allow);
      await service.all({ table: `schema.${'t'.repeat(249)}`, tableId: RESOURCE_ID });
      expect(repo.findAndCount).toHaveBeenCalled();

      await expect(service.all({ table: 't'.repeat(257), tableId: RESOURCE_ID })).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns the same non-enumerating 404 when policy is absent or denies access', async () => {
      const repo = makeRepoMock();
      const noPolicy = new ActionHistoryService(repo, ctx('T1', 'u1'));
      await expect(noPolicy.all({ table: 'deal', tableId: RESOURCE_ID })).rejects.toBeInstanceOf(NotFoundException);

      const denied = new ActionHistoryService(repo, ctx('T1', 'u2'), undefined, { authorizeRead: () => false });
      await expect(denied.all({ table: 'deal', tableId: RESOURCE_ID })).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.findAndCount).not.toHaveBeenCalled();
    });

    it('fails closed when tenant context is missing', async () => {
      const service = new ActionHistoryService(makeRepoMock(), ctx(undefined, 'u1'), undefined, allow);
      await expect(service.all({ table: 'deal', tableId: RESOURCE_ID })).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
