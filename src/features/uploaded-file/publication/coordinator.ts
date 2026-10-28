import { createHash, randomUUID } from 'node:crypto';
import type {
  UploadedFilePublicationBinding,
  UploadedFilePublicationConfig,
  UploadedFilePublicationCoordinator,
  UploadedFilePublicationIntent,
  UploadedFilePublicationLease,
  UploadedFilePublicationOptions,
  UploadedFilePublicationSource,
  UploadedFilePublicationState,
} from './types';

export class UploadedFilePublicationError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'UploadedFilePublicationError';
  }
}
const fail = (code = 'core.file.publication.invalid-descriptor'): never => {
  throw new UploadedFilePublicationError(code);
};
export const publicationHash = (value: string): string => createHash('sha256').update(value).digest('hex');
export const publicationHasControlCharacter = (value: string): boolean =>
  Array.from(value).some((character) => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127);
const part = (value: unknown): string => {
  if (
    typeof value !== 'string' ||
    !value ||
    value !== value.trim() ||
    value.length > 256 ||
    value.includes('/') ||
    value.includes('\\') ||
    publicationHasControlCharacter(value) ||
    value === '.' ||
    value === '..'
  )
    return fail();
  try {
    encodeURIComponent(value);
  } catch {
    return fail();
  }
  return value;
};
export const publicationBinding = (value: UploadedFilePublicationBinding): UploadedFilePublicationBinding => ({
  environment: part(value?.environment),
  module: part(value?.module),
  scopeId: part(value?.scopeId),
  bindingId: part(value?.bindingId),
  generation: part(value?.generation),
});
export const publicationSource = (value: UploadedFilePublicationSource): UploadedFilePublicationSource => {
  if (
    !value ||
    typeof value.locator !== 'string' ||
    !value.locator ||
    value.locator.length > 2048 ||
    publicationHasControlCharacter(value.locator) ||
    !/^[a-f0-9]{64}$/.test(value.sha256) ||
    !Number.isSafeInteger(value.size) ||
    value.size <= 0 ||
    !/^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/.test(value.contentType)
  )
    return fail();
  return {
    id: part(value.id),
    version: part(value.version),
    locator: value.locator,
    sha256: value.sha256,
    size: value.size,
    contentType: value.contentType,
  };
};
export const publicationCdnBase = (value: unknown): string => {
  if (typeof value !== 'string' || !value || value !== value.trim() || value.length > 2048)
    return fail('core.file.publication.not-configured');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fail('core.file.publication.not-configured');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    value.includes('?') ||
    value.includes('#') ||
    url.search ||
    url.hash ||
    value.includes('\\') ||
    publicationHasControlCharacter(value) ||
    value.split('/').some((segment) => /^(?:\.|%2e){1,2}$/i.test(segment))
  )
    return fail('core.file.publication.not-configured');
  return url.toString().replace(/\/+$/, '');
};
const descriptor = (
  binding: UploadedFilePublicationBinding,
  source: UploadedFilePublicationSource,
  target: UploadedFilePublicationIntent['target'],
): string => publicationHash(JSON.stringify({ binding, source, target }));

/** Pure, DI-friendly coordinator. It owns no HTTP route, database connection or background runner. */
export function createUploadedFilePublicationCoordinator<A = unknown, T = unknown>(
  options: UploadedFilePublicationOptions<A, T>,
): UploadedFilePublicationCoordinator<A, T> {
  const { policy, repository, storage } = options;
  const clock = options.clock ?? Date.now;
  const newId = options.newId ?? randomUUID;
  // Copy configuration so later caller mutation cannot redirect an already-created coordinator.
  const config: UploadedFilePublicationConfig = { ...options.config, modulePrefixes: { ...options.config.modulePrefixes } };
  const leaseMs = config.leaseMs ?? 30_000;
  const retryMs = config.retryMs ?? 30_000;
  if (![leaseMs, retryMs].every((value) => Number.isSafeInteger(value) && value >= 1 && value <= 3_600_000)) fail();

  const authorizedBinding = (value: UploadedFilePublicationBinding): UploadedFilePublicationBinding => {
    const binding = publicationBinding(value);
    if (binding.environment !== config.environment || !Object.hasOwn(config.modulePrefixes, binding.module)) {
      return fail('core.file.publication.namespace-denied');
    }
    part(config.modulePrefixes[binding.module]);
    return binding;
  };
  const targetFor = (binding: UploadedFilePublicationBinding, source: UploadedFilePublicationSource) => {
    if (
      config.deliveryMode !== 'external' ||
      binding.environment !== config.environment ||
      !Object.hasOwn(config.modulePrefixes, binding.module)
    )
      return fail('core.file.publication.not-configured');
    const base = publicationCdnBase(config.cdnBaseUrl);
    const prefix =
      config.keyPrefix === '' ? '' : typeof config.keyPrefix === 'string' ? config.keyPrefix.split('/').map(part).join('/') : fail();
    const modulePrefix = part(config.modulePrefixes[binding.module]);
    const identity = publicationHash(JSON.stringify([binding.bindingId, binding.generation]));
    const key = [prefix, part(binding.environment), modulePrefix, 'public', encodeURIComponent(binding.scopeId), identity, source.sha256]
      .filter(Boolean)
      .join('/');
    return { key, url: base + '/' + key.split('/').map(encodeURIComponent).join('/'), deliveryMode: 'external' as const };
  };
  const verify = (input: UploadedFilePublicationIntent): UploadedFilePublicationIntent => {
    const binding = authorizedBinding(input?.binding);
    const source = publicationSource(input?.source);
    const target = targetFor(binding, source);
    if (
      input.target?.key !== target.key ||
      input.target?.url !== target.url ||
      input.target?.deliveryMode !== 'external' ||
      !Number.isSafeInteger(input.createdAt) ||
      input.createdAt < 0 ||
      input.descriptorHash !== descriptor(binding, source, target)
    )
      return fail();
    return Object.freeze({
      id: part(input.id),
      binding: Object.freeze(binding),
      source: Object.freeze(source),
      target: Object.freeze(target),
      descriptorHash: input.descriptorHash,
      createdAt: input.createdAt,
    });
  };
  const save = async (
    work: UploadedFilePublicationLease,
    state: Exclude<UploadedFilePublicationState, 'ready'>,
    code: string,
  ): Promise<boolean> => repository.record(work, { state, code, nextAttemptAt: clock() + retryMs });
  return {
    async stage(assignment, transaction) {
      const resolved = await policy.resolve(assignment, transaction);
      const binding = authorizedBinding(resolved?.binding);
      if (resolved.visibility === 'private') {
        const { generation: _generation, ...logical } = binding;
        await repository.retireLogicalBinding(transaction, logical);
        return { visibility: 'private', intentId: null };
      }
      if (resolved.visibility !== 'public') return fail('core.file.publication.policy-denied');
      const source = publicationSource(resolved.source);
      const target = targetFor(binding, source);
      const intent = verify({
        id: newId(),
        binding,
        source,
        target,
        descriptorHash: descriptor(binding, source, target),
        createdAt: clock(),
      });
      const stored = verify(await repository.stage(transaction, intent));
      // A transaction retry may return the first id/time, but may never change its descriptor.
      if (stored.descriptorHash !== intent.descriptorHash) return fail('core.file.publication.generation-conflict');
      return { visibility: 'public', intentId: stored.id };
    },
    async retire(binding, transaction) {
      await repository.retire(transaction, authorizedBinding(binding));
    },
    async run(intentId) {
      part(intentId);
      const now = clock();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), leaseMs);
      const signal = controller.signal;
      let owned: UploadedFilePublicationLease | undefined;
      const within = <R>(call: () => Promise<R>): Promise<R> =>
        new Promise((resolve, reject) => {
          const timeout = () => reject(new UploadedFilePublicationError('core.file.publication.deadline'));
          if (signal.aborted) {
            timeout();
            return;
          }
          signal.addEventListener('abort', timeout, { once: true });
          Promise.resolve()
            .then(() => {
              if (signal.aborted) return fail('core.file.publication.deadline');
              return call();
            })
            .then(resolve, reject)
            .finally(() => signal.removeEventListener('abort', timeout));
        });
      const record = async (state: Exclude<UploadedFilePublicationState, 'ready'>, code: string) =>
        owned ? within(() => save(owned!, state, code)) : false;
      const acknowledge = async (): Promise<'ready' | 'pending' | 'lost'> => {
        const result = await within(() => repository.commitReady(owned!, clock()));
        if (result === 'ready') return 'ready';
        if (result === 'lost') return 'lost';
        if (result !== 'stale') return fail();
        return (await record('retiring', 'core.file.publication.binding-retired')) ? 'pending' : 'lost';
      };
      try {
        const work = await within(() => repository.claim(intentId, { token: part(newId()), now, leaseUntil: now + leaseMs }));
        if (!work) return 'idle';
        const intent = verify(work.intent);
        if (
          intent.id !== intentId ||
          !Number.isSafeInteger(work.revision) ||
          work.revision < 0 ||
          !Number.isSafeInteger(work.leaseUntil) ||
          !['publish', 'retire'].includes(work.action)
        )
          return fail();
        part(work.token);
        owned = { ...work, intent };
        if (work.leaseUntil <= clock()) return 'lost';
        // Claim recorded uncertainty before external I/O. Timeout does NOT prove remote cancellation.
        if (work.action === 'publish' && !(await within(() => repository.isCurrent(owned!)))) {
          return (await record('retiring', 'core.file.publication.binding-retired')) ? 'pending' : 'lost';
        }
        const observed = await within(() => storage.inspect(intent, signal));
        if (observed === 'conflict') {
          return (await record('blocked', 'core.file.publication.object-conflict')) ? 'blocked' : 'lost';
        }
        if (observed === 'unknown') {
          return (await record(work.action === 'retire' ? 'retiring' : 'uncertain', 'core.file.publication.outcome-unknown'))
            ? 'pending'
            : 'lost';
        }
        if (observed !== 'matching' && observed !== 'absent') return fail();
        if (work.action === 'retire') {
          if (observed === 'matching') {
            const removed = await within(() => storage.removeExact(intent, signal));
            if (removed !== 'acknowledged') {
              return (await record('retiring', 'core.file.publication.retirement-unknown')) ? 'pending' : 'lost';
            }
          }
          // Keep a due tombstone after removal/absence, so late abandoned PUTs are still retired.
          return (await record('retired', 'core.file.publication.retired')) ? 'retired' : 'lost';
        }
        if (observed === 'matching') return await acknowledge();
        if (!(await within(() => repository.isCurrent(owned!)))) {
          return (await record('retiring', 'core.file.publication.binding-retired')) ? 'pending' : 'lost';
        }
        const written = await within(() => storage.publish(intent, signal));
        if (written !== 'acknowledged') {
          return (await record('uncertain', 'core.file.publication.outcome-unknown')) ? 'pending' : 'lost';
        }
        return await acknowledge();
      } catch (error) {
        if (!owned && error instanceof UploadedFilePublicationError && error.code !== 'core.file.publication.deadline') throw error;
        // Never delete on an ambiguous DB commit. Exact CAS cannot overwrite a newer ready lease.
        // If the deadline/state write fails, durable uncertainty from claim remains for reconciliation.
        if (owned && !signal.aborted) {
          try {
            await record(owned.action === 'retire' ? 'retiring' : 'uncertain', 'core.file.publication.outcome-unknown');
          } catch {
            /* durable claim survives */
          }
        }
        return 'pending';
      } finally {
        clearTimeout(timer);
      }
    },
    async project(binding) {
      const checked = authorizedBinding(binding);
      const row = await repository.readCurrent(checked);
      if (!row) return { url: null, state: 'private' };
      const intent = verify(row.intent);
      if (!['pending', 'uncertain', 'ready', 'retiring', 'retired', 'blocked'].includes(row.state)) return fail();
      if (JSON.stringify(intent.binding) !== JSON.stringify(checked)) return fail();
      return { url: row.state === 'ready' ? intent.target.url : null, state: row.state };
    },
  };
}
