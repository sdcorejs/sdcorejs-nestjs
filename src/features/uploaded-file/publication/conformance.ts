import { createHash } from 'node:crypto';
import { createUploadedFilePublicationCoordinator, publicationBinding, publicationSource } from './coordinator';
import { createUploadedFilePublicationStorage } from './storage';
import type {
  UploadedFilePublicationBinding,
  UploadedFilePublicationIntent,
  UploadedFilePublicationObjectMetadata,
  UploadedFilePublicationRepository,
  UploadedFilePublicationSource,
  UploadedFilePublicationState,
} from './types';

/** Trusted synthetic schema-compatible profile; this does not override consumer authorization. */
export interface UploadedFilePublicationConformanceProfile {
  binding: UploadedFilePublicationBinding;
  replacementGeneration: string;
  source: Pick<UploadedFilePublicationSource, 'id' | 'version' | 'locator' | 'contentType'>;
  modulePrefix: string;
}
export interface UploadedFilePublicationConformanceFixture<T = unknown> {
  profile?: UploadedFilePublicationConformanceProfile;
  repository: UploadedFilePublicationRepository<T>;
  /** Fixture domain transaction: replace the one synthetic logical binding, then run Core staging. */
  withAssignment<R>(binding: UploadedFilePublicationBinding | null, work: (transaction: T) => Promise<R>): Promise<R>;
  inspectIntent(id: string): Promise<{ intent: UploadedFilePublicationIntent; state: UploadedFilePublicationState } | null>;
  dispose?(): Promise<void>;
}
export type UploadedFilePublicationConformanceFactory<T = unknown> = (options: {
  clock: () => number;
}) => Promise<UploadedFilePublicationConformanceFixture<T>>;
export interface UploadedFilePublicationConformanceResult {
  id: string;
  status: 'PASS' | 'FAIL';
  error?: string;
}

/**
 * Same protocol vectors for every consumer repository adapter. No Jest, DB, HTTP or SDK dependency.
 * Only synthetic bytes/object ports are used. Callers provide an isolated local durable adapter;
 * this suite never verifies real CDN access and must never receive a production repository.
 */
export async function runUploadedFilePublicationConformance<T>(
  factory: UploadedFilePublicationConformanceFactory<T>,
): Promise<UploadedFilePublicationConformanceResult[]> {
  const results: UploadedFilePublicationConformanceResult[] = [];
  const check = (value: unknown, label: string): void => {
    if (!value) throw new Error(label);
  };
  type Scenario = (fixture: UploadedFilePublicationConformanceFixture<T>, tools: Awaited<ReturnType<typeof make>>) => Promise<void>;
  const make = async (fixture: UploadedFilePublicationConformanceFixture<T>, clock: () => number, tick: () => void) => {
    // UUID-shaped fixture identifiers support native UUID columns without restricting Core's neutral string contracts.
    const defaultBinding: UploadedFilePublicationBinding = {
      environment: 'test',
      module: 'asset',
      scopeId: '40000000-0000-4000-8000-000000000001',
      bindingId: '10000000-0000-4000-8000-000000000001',
      generation: '20000000-0000-4000-8000-000000000001',
    };
    const bytes = Buffer.from('synthetic-publication-source');
    const defaultSource = {
      id: '30000000-0000-4000-8000-000000000001',
      version: 'immutable-v1',
      locator: 'trusted-private-source',
      sha256: createHash('sha256').update(bytes).digest('hex'),
      size: bytes.length,
      contentType: 'text/plain',
    };
    const profile = fixture.profile;
    const binding = publicationBinding(profile === undefined ? defaultBinding : profile.binding);
    const replacement = publicationBinding({
      ...binding,
      generation: profile === undefined ? '20000000-0000-4000-8000-000000000002' : profile.replacementGeneration,
    });
    check(replacement.generation !== binding.generation, 'replacement generation must differ');
    const modulePrefix = profile === undefined ? 'app-assets' : profile.modulePrefix;
    publicationBinding({ ...binding, module: modulePrefix });
    const source = publicationSource({
      ...(profile === undefined ? defaultSource : profile.source),
      sha256: createHash('sha256').update(bytes).digest('hex'),
      size: bytes.length,
    });
    const namespace = [binding.environment, modulePrefix, 'public'].map(encodeURIComponent).join('/');
    const foreignScope =
      binding.scopeId === '90000000-0000-4000-8000-000000000001'
        ? '90000000-0000-4000-8000-000000000002'
        : '90000000-0000-4000-8000-000000000001';
    const objects = new Map<string, UploadedFilePublicationObjectMetadata>();
    let puts = 0,
      deletes = 0,
      id = 0;
    let putUnknown = false,
      deleteUnknown = false,
      headUnknown = false;
    let beforePut: (() => Promise<void>) | undefined;
    const storage = createUploadedFilePublicationStorage({
      deliveryProfile: { id: 'synthetic-config', cdnBaseUrl: 'https://cdn.example.test', mode: 'external' },
      readSource: async () => ({ bytes, version: source.version }),
      objects: {
        headExact: async (key) => (headUnknown ? 'unknown' : (objects.get(key) ?? null)),
        putImmutable: async (key, _bytes, metadata) => {
          puts++;
          await beforePut?.();
          if (objects.has(key)) return 'conflict';
          objects.set(key, { ...metadata });
          return putUnknown ? 'unknown' : 'acknowledged';
        },
        deleteExact: async (key, hash) => {
          deletes++;
          if (objects.has(key) && objects.get(key)!.descriptorHash !== hash) return 'conflict';
          if (deleteUnknown) return 'unknown';
          objects.delete(key);
          return 'acknowledged';
        },
      },
    });
    type Assignment =
      | { visibility: 'private'; binding: UploadedFilePublicationBinding }
      | { visibility: 'public'; binding: UploadedFilePublicationBinding; source: typeof source };
    const coordinator = createUploadedFilePublicationCoordinator<Assignment, T>({
      config: {
        environment: binding.environment,
        keyPrefix: '',
        modulePrefixes: { [binding.module]: modulePrefix },
        cdnBaseUrl: 'https://cdn.example.test',
        deliveryMode: 'external',
        retryMs: 1,
        leaseMs: 100,
      },
      policy: { resolve: async (assignment) => assignment },
      repository: fixture.repository,
      storage,
      clock,
      newId: () => '70000000-0000-4000-8000-' + String(++id).padStart(12, '0'),
    });
    const stage = (b = binding, visibility: 'public' | 'private' = 'public', s = source) =>
      fixture.withAssignment(b, (tx) =>
        coordinator.stage(visibility === 'public' ? { visibility, binding: b, source: s } : { visibility, binding: b }, tx),
      );
    const unlink = () => fixture.withAssignment(null, (tx) => coordinator.retire(binding, tx));
    return {
      binding,
      replacement,
      source,
      namespace,
      foreignScope,
      coordinator,
      objects,
      stage,
      unlink,
      tick,
      puts: () => puts,
      deletes: () => deletes,
      putUnknown: (value: boolean) => {
        putUnknown = value;
      },
      deleteUnknown: (value: boolean) => {
        deleteUnknown = value;
      },
      headUnknown: (value: boolean) => {
        headUnknown = value;
      },
      beforePut: (value: () => Promise<void>) => {
        beforePut = value;
      },
    };
  };
  const cases: Array<[string, Scenario]> = [
    [
      'PUB-01-private-default',
      async (_f, t) => {
        const staged = await t.stage(t.binding, 'private');
        check(staged.intentId === null && t.puts() === 0, 'private assignment created publication');
        check((await t.coordinator.project(t.binding)).url === null, 'private URL exposed');
        for (const denied of [
          { ...t.binding, environment: t.binding.environment === 'foreign-environment' ? 'other-environment' : 'foreign-environment' },
          { ...t.binding, module: t.binding.module === 'foreign-module' ? 'other-module' : 'foreign-module' },
        ]) {
          let rejected = false;
          try {
            await t.coordinator.project(denied);
          } catch {
            rejected = true;
          }
          check(rejected, 'foreign namespace was not rejected');
        }
      },
    ],
    [
      'PUB-02-ack-before-url',
      async (_f, t) => {
        const staged = await t.stage();
        check((await t.coordinator.project(t.binding)).url === null, 'pending URL exposed');
        check((await t.coordinator.run(staged.intentId!)) === 'ready', 'ack did not become ready');
        check(
          (await t.coordinator.project(t.binding)).url?.startsWith('https://cdn.example.test/' + t.namespace + '/'),
          'wrong namespace/CDN',
        );
        check((await t.coordinator.project({ ...t.binding, scopeId: t.foreignScope })).url === null, 'foreign scope exposed a URL');
        check(t.puts() === 1, 'unexpected write count');
      },
    ],
    [
      'PUB-03-idempotent-stage',
      async (_f, t) => {
        const first = await t.stage(),
          second = await t.stage();
        check(first.intentId === second.intentId, 'retry created another intent');
      },
    ],
    [
      'PUB-04-generation-conflict',
      async (_f, t) => {
        await t.stage();
        let rejected = false;
        try {
          await t.stage(t.binding, 'public', { ...t.source, version: 'changed-version' });
        } catch {
          rejected = true;
        }
        check(rejected, 'same generation silently changed descriptor');
      },
    ],
    [
      'PUB-05-lost-put-ack-reconciles',
      async (_f, t) => {
        const staged = await t.stage();
        t.putUnknown(true);
        check((await t.coordinator.run(staged.intentId!)) === 'pending', 'unknown PUT exposed URL');
        check((await t.coordinator.project(t.binding)).url === null, 'unknown outcome URL exposed');
        t.tick();
        t.putUnknown(false);
        check((await t.coordinator.run(staged.intentId!)) === 'ready', 'matching object did not reconcile');
        check(t.puts() === 1, 'reconcile rewrote existing object');
      },
    ],
    [
      'PUB-06-unknown-head-no-put',
      async (_f, t) => {
        const staged = await t.stage();
        t.headUnknown(true);
        check((await t.coordinator.run(staged.intentId!)) === 'pending' && t.puts() === 0, 'unknown HEAD treated as absent');
      },
    ],
    [
      'PUB-07-replace-during-put',
      async (f, t) => {
        const staged = await t.stage();
        t.beforePut(async () => {
          await f.withAssignment(t.replacement, async () => undefined);
        });
        check((await t.coordinator.run(staged.intentId!)) === 'pending', 'stale completion became ready');
        check((await t.coordinator.project(t.binding)).url === null, 'replaced generation exposed');
        t.tick();
        check((await t.coordinator.run(staged.intentId!)) === 'retired', 'stale rendition not retired');
        check(t.objects.size === 0, 'stale rendition retained');
      },
    ],
    [
      'PUB-08-unlink-hides-before-delete',
      async (_f, t) => {
        const staged = await t.stage();
        await t.coordinator.run(staged.intentId!);
        await t.unlink();
        check((await t.coordinator.project(t.binding)).url === null, 'unlink retained URL');
        t.tick();
        check((await t.coordinator.run(staged.intentId!)) === 'retired' && t.objects.size === 0, 'unlink did not retire exact object');
      },
    ],
    [
      'PUB-09-private-new-generation-retires-old',
      async (f, t) => {
        const first = await t.stage();
        await t.coordinator.run(first.intentId!);
        await t.stage(t.replacement, 'private');
        check((await f.inspectIntent(first.intentId!))?.state === 'retiring', 'old public generation not queued for retirement');
        t.tick();
        await t.coordinator.run(first.intentId!);
        check(t.objects.size === 0, 'private replacement leaked old rendition');
      },
    ],
    [
      'PUB-10-retirement-tombstone-late-put',
      async (_f, t) => {
        const staged = await t.stage();
        await t.coordinator.run(staged.intentId!);
        const late = [...t.objects.entries()][0];
        await t.unlink();
        t.tick();
        await t.coordinator.run(staged.intentId!);
        t.objects.set(late[0], late[1]);
        t.tick();
        check((await t.coordinator.run(staged.intentId!)) === 'retired' && t.objects.size === 0, 'late abandoned PUT escaped tombstone');
      },
    ],
    [
      'PUB-11-stale-lease-cannot-settle',
      async (f, t) => {
        const staged = await t.stage();
        const first = await f.repository.claim(staged.intentId!, {
          token: '80000000-0000-4000-8000-000000000001',
          now: 1000,
          leaseUntil: 1001,
        });
        t.tick(); // Advance the injected repository/database clock, not only the caller's now value.
        const second = await f.repository.claim(staged.intentId!, {
          token: '80000000-0000-4000-8000-000000000002',
          now: 1100,
          leaseUntil: 1200,
        });
        check(first && second, 'expired lease was not reclaimable');
        check((await f.repository.commitReady(first!, 1101)) === 'lost', 'stale lease committed ready');
        check(
          !(await f.repository.record(first!, { state: 'blocked', code: 'synthetic', nextAttemptAt: 1300 })),
          'stale lease overwrote newer work',
        );
      },
    ],
    [
      'PUB-12-retirement-unknown-retries',
      async (_f, t) => {
        const staged = await t.stage();
        await t.coordinator.run(staged.intentId!);
        await t.unlink();
        t.deleteUnknown(true);
        t.tick();
        check((await t.coordinator.run(staged.intentId!)) === 'pending', 'unknown delete marked retired');
        check((await t.coordinator.project(t.binding)).url === null, 'unknown deletion exposed URL');
        t.deleteUnknown(false);
        t.tick();
        check((await t.coordinator.run(staged.intentId!)) === 'retired', 'retirement did not reconcile');
      },
    ],
  ];
  for (const [id, scenario] of cases) {
    let fixture: UploadedFilePublicationConformanceFixture<T> | undefined;
    try {
      let now = 1000;
      fixture = await factory({ clock: () => now });
      await scenario(
        fixture,
        await make(
          fixture,
          () => now,
          () => {
            now += 101;
          },
        ),
      );
      results.push({ id, status: 'PASS' });
    } catch (error) {
      results.push({ id, status: 'FAIL', error: error instanceof Error ? error.message : 'Conformance failed' });
    } finally {
      await fixture?.dispose?.();
    }
  }
  return results;
}
