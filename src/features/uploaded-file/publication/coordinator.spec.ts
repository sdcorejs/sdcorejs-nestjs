import { createHash } from 'node:crypto';
import { createUploadedFilePublicationCoordinator } from './coordinator';
import { runUploadedFilePublicationConformance } from './conformance';
import type { UploadedFilePublicationConformanceFixture } from './conformance';
import type {
  UploadedFilePublicationBinding as Binding,
  UploadedFilePublicationIntent as Intent,
  UploadedFilePublicationLease as Lease,
  UploadedFilePublicationRepository,
  UploadedFilePublicationState as State,
} from './types';

type Row = { intent: Intent; state: State; token?: string; revision: number; leaseUntil: number; next: number };
export function fixture(clock: () => number): UploadedFilePublicationConformanceFixture<undefined> & { rows: Map<string, Row> } {
  const rows = new Map<string, Row>();
  let current: Binding | null = null;
  const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const logical = (b: Binding | Omit<Binding, 'generation'>) => JSON.stringify([b.environment, b.module, b.scopeId, b.bindingId]);
  const owned = (w: Lease) => {
    const row = rows.get(w.intent.id);
    return row && row.token === w.token && row.revision === w.revision && row.intent.descriptorHash === w.intent.descriptorHash
      ? row
      : undefined;
  };
  const retireRow = (row: Row) => {
    row.state = 'retiring';
    row.token = undefined;
    row.revision++;
    row.next = 0;
    row.leaseUntil = 0;
  };
  const repository: UploadedFilePublicationRepository<undefined> = {
    async stage(_tx, intent) {
      const old = [...rows.values()].find((r) => equal(r.intent.binding, intent.binding));
      if (old) {
        if (old.intent.descriptorHash !== intent.descriptorHash) throw Error('generation conflict');
        return structuredClone(old.intent);
      }
      for (const row of rows.values()) if (logical(row.intent.binding) === logical(intent.binding)) retireRow(row);
      rows.set(intent.id, { intent: structuredClone(intent), state: 'pending', revision: 0, leaseUntil: 0, next: 0 });
      return structuredClone(intent);
    },
    async retireLogicalBinding(_tx, binding) {
      for (const row of rows.values()) if (logical(row.intent.binding) === logical(binding)) retireRow(row);
    },
    async retire(_tx, binding) {
      for (const row of rows.values()) if (equal(row.intent.binding, binding)) retireRow(row);
    },
    async claim(id, claim) {
      const row = rows.get(id);
      if (!row || ['ready', 'blocked'].includes(row.state) || row.next > claim.now || (row.token && row.leaseUntil > claim.now))
        return null;
      const action = ['retiring', 'retired'].includes(row.state) ? 'retire' : 'publish';
      row.token = claim.token;
      row.revision++;
      row.leaseUntil = claim.leaseUntil;
      if (action === 'publish') row.state = 'uncertain';
      return { intent: structuredClone(row.intent), token: row.token, revision: row.revision, leaseUntil: row.leaseUntil, action };
    },
    async isCurrent(work) {
      return !!owned(work) && equal(current, work.intent.binding);
    },
    async commitReady(work, now) {
      const row = owned(work);
      if (!row || row.leaseUntil <= now || row.leaseUntil <= clock()) return 'lost';
      if (!equal(current, work.intent.binding)) return 'stale';
      row.state = 'ready';
      row.token = undefined;
      row.revision++;
      return 'ready';
    },
    async record(work, result) {
      const row = owned(work);
      if (!row) return false;
      row.state = result.state;
      row.next = result.nextAttemptAt;
      row.token = undefined;
      row.revision++;
      return true;
    },
    async readCurrent(binding) {
      if (!equal(current, binding)) return null;
      const row = [...rows.values()].find((r) => equal(r.intent.binding, binding));
      return row ? { intent: structuredClone(row.intent), state: row.state } : null;
    },
  };
  return {
    rows,
    repository,
    async withAssignment(binding, work) {
      const previous = current;
      const saved = structuredClone([...rows.entries()]);
      current = binding;
      try {
        return await work(undefined);
      } catch (error) {
        current = previous;
        rows.clear();
        for (const [id, row] of saved) rows.set(id, row);
        throw error;
      }
    },
    async inspectIntent(id) {
      const row = rows.get(id);
      return row ? { intent: structuredClone(row.intent), state: row.state } : null;
    },
  };
}

/** Test model of a durable adapter whose database clock, not caller.now, governs lease expiry. */
function databaseClockFixture(clock: () => number) {
  const f = fixture(clock),
    claim = f.repository.claim,
    commitReady = f.repository.commitReady;
  f.repository.claim = (id, request) => claim(id, { ...request, now: clock() });
  f.repository.commitReady = (work, _callerNow) => commitReady(work, clock());
  return f;
}

const bytes = Buffer.from('synthetic');
const binding: Binding = { environment: 'test', module: 'asset', scopeId: 'scope-A', bindingId: 'logo', generation: 'v1' };
const source = {
  id: 'source',
  version: 'v1',
  locator: 'private-source',
  sha256: createHash('sha256').update(bytes).digest('hex'),
  size: bytes.length,
  contentType: 'image/png',
};
const setup = (leaseMs = 1000) => {
  const f = fixture(Date.now);
  let id = 0;
  const storage = {
    inspect: jest.fn(async () => 'absent' as 'absent' | 'matching' | 'unknown' | 'conflict'),
    publish: jest.fn(async () => 'acknowledged' as 'acknowledged' | 'unknown'),
    removeExact: jest.fn(async () => 'acknowledged' as 'acknowledged' | 'unknown'),
  };
  const options = {
    config: {
      environment: 'test',
      keyPrefix: '',
      modulePrefixes: { asset: 'app-assets' },
      cdnBaseUrl: 'https://cdn.example.test',
      deliveryMode: 'external' as const,
      leaseMs,
    },
    policy: { resolve: async () => ({ visibility: 'public' as const, binding, source }) },
    repository: f.repository,
    storage,
    newId: () => String(++id),
  };
  const coordinator = createUploadedFilePublicationCoordinator(options);
  const stage = () => f.withAssignment(binding, (tx) => coordinator.stage(undefined, tx));
  return { f, storage, options, coordinator, stage };
};

describe('shared attachment publication coordinator', () => {
  it('passes the same 12 consumer conformance vectors', async () => {
    const results = await runUploadedFilePublicationConformance(async ({ clock }) => fixture(clock));
    expect(results).toHaveLength(12);
    expect(results.filter((r) => r.status === 'FAIL')).toEqual([]);
  });
  it('advances the repository clock for the stale lease vector', async () => {
    const observedClocks: number[] = [];
    const results = await runUploadedFilePublicationConformance(async ({ clock }) => {
      const f = databaseClockFixture(clock),
        claim = f.repository.claim;
      f.repository.claim = (id, request) => {
        if (['80000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000002'].includes(request.token)) {
          observedClocks.push(clock());
        }
        return claim(id, request);
      };
      return f;
    });
    expect(results).toHaveLength(12);
    expect(results.filter((result) => result.status === 'FAIL')).toEqual([]);
    expect(observedClocks).toEqual([1000, 1101]);
  });
  it('does not steal a live lease using a caller-supplied future time', async () => {
    let now = 1000;
    const f = databaseClockFixture(() => now);
    const c = createUploadedFilePublicationCoordinator({ ...setup().options, repository: f.repository, clock: () => now });
    const staged = await f.withAssignment(binding, (tx) => c.stage(undefined, tx));
    const first = await f.repository.claim(staged.intentId!, {
      token: '80000000-0000-4000-8000-000000000001',
      now: 1000,
      leaseUntil: 1100,
    });
    expect(first).not.toBeNull();
    expect(
      await f.repository.claim(staged.intentId!, {
        token: '80000000-0000-4000-8000-000000000002',
        now: 10000,
        leaseUntil: 12000,
      }),
    ).toBeNull();
    now = 1101;
    expect(await f.repository.commitReady(first!, 1000)).toBe('lost');
    const second = await f.repository.claim(staged.intentId!, {
      token: '80000000-0000-4000-8000-000000000002',
      now: 1000,
      leaseUntil: 1200,
    });
    expect(second).not.toBeNull();
  });
  it('passes only UUID-shaped default record and lease identifiers to UUID-backed ports', async () => {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const calls = new Set<string>(),
      tokens = new Set<string>();
    const checkId = (value: string) => expect(value).toMatch(uuid);
    const checkBinding = (value: Binding | Omit<Binding, 'generation'>) => {
      checkId(value.scopeId);
      checkId(value.bindingId);
      if ('generation' in value) checkId(value.generation);
    };
    const checkIntent = (value: Intent) => {
      checkId(value.id);
      checkId(value.source.id);
      checkBinding(value.binding);
    };
    const checkLease = (value: Lease) => {
      checkIntent(value.intent);
      checkId(value.token);
    };
    const results = await runUploadedFilePublicationConformance(async ({ clock }) => {
      const f = fixture(clock),
        actual = f.repository;
      const repository: UploadedFilePublicationRepository<undefined> = {
        async stage(tx, intent) {
          calls.add('stage');
          checkIntent(intent);
          return actual.stage(tx, intent);
        },
        async retireLogicalBinding(tx, value) {
          calls.add('retireLogicalBinding');
          checkBinding(value);
          return actual.retireLogicalBinding(tx, value);
        },
        async retire(tx, value) {
          calls.add('retire');
          checkBinding(value);
          return actual.retire(tx, value);
        },
        async claim(id, value) {
          calls.add('claim');
          checkId(id);
          checkId(value.token);
          tokens.add(value.token);
          const work = await actual.claim(id, value);
          if (work) checkLease(work);
          return work;
        },
        async isCurrent(work) {
          calls.add('isCurrent');
          checkLease(work);
          return actual.isCurrent(work);
        },
        async commitReady(work, now) {
          calls.add('commitReady');
          checkLease(work);
          return actual.commitReady(work, now);
        },
        async record(work, result) {
          calls.add('record');
          checkLease(work);
          return actual.record(work, result);
        },
        async readCurrent(value) {
          calls.add('readCurrent');
          checkBinding(value);
          const row = await actual.readCurrent(value);
          if (row) checkIntent(row.intent);
          return row;
        },
      };
      const checked: UploadedFilePublicationConformanceFixture<undefined> = {
        ...f,
        repository,
        async withAssignment(value, work) {
          if (value) checkBinding(value);
          return f.withAssignment(value, work);
        },
        async inspectIntent(id) {
          checkId(id);
          const row = await f.inspectIntent(id);
          if (row) checkIntent(row.intent);
          return row;
        },
      };
      return checked;
    });
    expect(results).toHaveLength(12);
    expect(results.filter((result) => result.status === 'FAIL')).toEqual([]);
    expect([...calls].sort()).toEqual(
      ['stage', 'retireLogicalBinding', 'retire', 'claim', 'isCurrent', 'commitReady', 'record', 'readCurrent'].sort(),
    );
    expect(tokens.has('80000000-0000-4000-8000-000000000001')).toBe(true);
    expect(tokens.has('80000000-0000-4000-8000-000000000002')).toBe(true);
  });
  it.each([
    undefined,
    '',
    'http://cdn.example.test',
    'https://u:p@cdn.example.test',
    'https://cdn.example.test/?token=x',
    'https://cdn.example.test/a/../b',
    'https://cdn.example.test?',
    'https://cdn.example.test#',
  ])('rejects missing/unsafe CDN base %s before repository insert', async (base) => {
    const s = setup();
    s.options.config.cdnBaseUrl = base as string;
    const c = createUploadedFilePublicationCoordinator(s.options);
    await expect(s.f.withAssignment(binding, (tx) => c.stage(undefined, tx))).rejects.toHaveProperty(
      'code',
      'core.file.publication.not-configured',
    );
    expect(s.f.rows.size).toBe(0);
    expect(s.storage.publish).not.toHaveBeenCalled();
  });
  it('preserves a legitimate configured CDN base path', async () => {
    const s = setup();
    s.options.config.cdnBaseUrl = 'https://cdn.example.test/assets/images/';
    const c = createUploadedFilePublicationCoordinator(s.options);
    const r = await s.f.withAssignment(binding, (tx) => c.stage(undefined, tx));
    expect(s.f.rows.get(r.intentId!)!.intent.target.url).toMatch(
      /^https:\/\/cdn\.example\.test\/assets\/images\/test\/app-assets\/public\//,
    );
  });
  it('runs the same vectors with a valid domain-shaped fixture profile', async () => {
    const results = await runUploadedFilePublicationConformance(async ({ clock }) => ({
      ...fixture(clock),
      profile: {
        binding: {
          environment: 'dev',
          module: 'admin',
          scopeId: '40000000-0000-4000-8000-000000000001',
          bindingId: '40000000-0000-4000-8000-000000000001-logo',
          generation: 'v1',
        },
        replacementGeneration: 'v2',
        modulePrefix: 'app-admin',
        source: { id: '30000000-0000-4000-8000-000000000001', version: 'v1', locator: 'trusted-private-fixture', contentType: 'image/png' },
      },
    }));
    expect(results).toHaveLength(12);
    expect(results.filter((r) => r.status === 'FAIL')).toEqual([]);
  });
  it('rejects an invalid profile before any repository mutation', async () => {
    const repositories: UploadedFilePublicationRepository<undefined>[] = [];
    const results = await runUploadedFilePublicationConformance(async ({ clock }) => {
      const f = fixture(clock);
      jest.spyOn(f.repository, 'stage');
      jest.spyOn(f.repository, 'retireLogicalBinding');
      repositories.push(f.repository);
      return {
        ...f,
        profile: { binding: { ...binding, scopeId: '../foreign' }, replacementGeneration: 'v2', modulePrefix: 'app-assets', source },
      };
    });
    expect(results.every((r) => r.status === 'FAIL')).toBe(true);
    for (const repository of repositories) {
      expect(repository.stage).not.toHaveBeenCalled();
      expect(repository.retireLogicalBinding).not.toHaveBeenCalled();
    }
  });
  it('rejects unconfigured module and path traversal', async () => {
    const s = setup();
    s.options.config.modulePrefixes = {} as { asset: string };
    await expect(createUploadedFilePublicationCoordinator(s.options).stage(undefined, undefined)).rejects.toHaveProperty(
      'code',
      'core.file.publication.namespace-denied',
    );
    const bad = { ...binding, scopeId: '../other' };
    s.options.policy.resolve = async () => ({ visibility: 'public', binding: bad, source });
    await expect(createUploadedFilePublicationCoordinator(s.options).stage(undefined, undefined)).rejects.toHaveProperty(
      'code',
      'core.file.publication.invalid-descriptor',
    );
  });
  it('uses empty root prefix and never exposes source locator', async () => {
    const s = setup();
    const r = await s.stage();
    const intent = s.f.rows.get(r.intentId!)!.intent;
    expect(intent.target.key).toMatch(/^test\/app-assets\/public\/scope-A\//);
    expect(intent.target.url).not.toContain(source.locator);
  });
  it('does not mutate configuration after creation', async () => {
    const s = setup();
    s.options.config.modulePrefixes.asset = 'foreign';
    const r = await s.stage();
    expect(s.f.rows.get(r.intentId!)!.intent.target.key).toContain('/app-assets/');
  });
  it('projects only ready states', async () => {
    const s = setup();
    const r = await s.stage();
    for (const state of ['pending', 'uncertain', 'retiring', 'retired', 'blocked'] as State[]) {
      s.f.rows.get(r.intentId!)!.state = state;
      expect((await s.coordinator.project(binding)).url).toBeNull();
    }
  });
  it('rejects a tampered persisted descriptor before object I/O', async () => {
    const s = setup();
    const r = await s.stage();
    s.f.rows.get(r.intentId!)!.intent.source = { ...source, sha256: '0'.repeat(64) };
    await expect(s.coordinator.run(r.intentId!)).rejects.toHaveProperty('code', 'core.file.publication.invalid-descriptor');
    expect(s.storage.inspect).not.toHaveBeenCalled();
  });
  it('blocks foreign object metadata without deleting it', async () => {
    const s = setup();
    const r = await s.stage();
    s.storage.inspect.mockResolvedValue('conflict');
    expect(await s.coordinator.run(r.intentId!)).toBe('blocked');
    expect(s.storage.publish).not.toHaveBeenCalled();
    expect(s.storage.removeExact).not.toHaveBeenCalled();
  });
  it.each(['inspect', 'publish'] as const)('bounds a never-resolving %s and leaves durable uncertainty', async (method) => {
    const s = setup(15);
    const r = await s.stage();
    s.storage[method].mockImplementation(
      () =>
        new Promise(() => {
          /* Deliberately unresolved to verify the bounded worker deadline. */
        }),
    );
    const start = Date.now();
    expect(await s.coordinator.run(r.intentId!)).toBe('pending');
    expect(Date.now() - start).toBeLessThan(1000);
    expect(s.f.rows.get(r.intentId!)!.state).toBe('uncertain');
    expect((await s.coordinator.project(binding)).url).toBeNull();
  });
  it('a late publish acknowledgement cannot make a timed-out binding ready', async () => {
    const s = setup(15);
    const r = await s.stage();
    let finish!: (value: 'acknowledged') => void;
    s.storage.publish.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    expect(await s.coordinator.run(r.intentId!)).toBe('pending');
    finish('acknowledged');
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect((await s.coordinator.project(binding)).url).toBeNull();
  });
  it('bounds an unresponsive repository claim', async () => {
    const s = setup(15);
    s.f.repository.claim = async () =>
      new Promise(() => {
        /* Deliberately unresolved to verify the bounded worker deadline. */
      });
    expect(await s.coordinator.run('intent')).toBe('pending');
  });
  it('ready DB acknowledgement loss never triggers object deletion', async () => {
    const s = setup();
    const r = await s.stage();
    const commit = s.f.repository.commitReady;
    s.f.repository.commitReady = async (...args) => {
      await commit(...args);
      throw Error('lost db ack');
    };
    expect(await s.coordinator.run(r.intentId!)).toBe('pending');
    expect(s.f.rows.get(r.intentId!)!.state).toBe('ready');
    expect(s.storage.removeExact).not.toHaveBeenCalled();
  });
});

describe('namespace checks on private cleanup and reads', () => {
  it.each([
    { ...binding, environment: 'other' },
    { ...binding, module: 'unlisted' },
  ])('rejects unauthorized binding before every repository path', async (bad) => {
    const s = setup();
    const retire = jest.spyOn(s.f.repository, 'retire');
    const logical = jest.spyOn(s.f.repository, 'retireLogicalBinding');
    const read = jest.spyOn(s.f.repository, 'readCurrent');
    const privatePolicy = { resolve: async () => ({ visibility: 'private' as const, binding: bad }) };
    const c = createUploadedFilePublicationCoordinator({ ...s.options, policy: privatePolicy });
    await expect(c.stage(undefined, undefined)).rejects.toHaveProperty('code', 'core.file.publication.namespace-denied');
    await expect(c.retire(bad, undefined)).rejects.toHaveProperty('code', 'core.file.publication.namespace-denied');
    await expect(c.project(bad)).rejects.toHaveProperty('code', 'core.file.publication.namespace-denied');
    expect(retire).not.toHaveBeenCalled();
    expect(logical).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });
  it('authorized private cleanup does not require working CDN configuration', async () => {
    const s = setup();
    const logical = jest.spyOn(s.f.repository, 'retireLogicalBinding');
    const c = createUploadedFilePublicationCoordinator({
      ...s.options,
      config: { ...s.options.config, cdnBaseUrl: undefined, deliveryMode: undefined },
      policy: { resolve: async () => ({ visibility: 'private' as const, binding }) },
    });
    expect(await c.stage(undefined, undefined)).toEqual({ visibility: 'private', intentId: null });
    expect(logical).toHaveBeenCalledWith(undefined, { environment: 'test', module: 'asset', scopeId: 'scope-A', bindingId: 'logo' });
  });
});
