import { createHash } from 'node:crypto';
import {
  publicationBinding,
  publicationCdnBase,
  publicationHash,
  publicationHasControlCharacter,
  publicationSource,
  UploadedFilePublicationError,
} from './coordinator';
import type {
  UploadedFilePublicationIntent,
  UploadedFilePublicationObjectMetadata,
  UploadedFilePublicationStorage,
  UploadedFilePublicationStorageOptions,
} from './types';

/**
 * Shared byte/object protocol. Consumer ports map transport and authorized reads only.
 * Matching means integrity + the requested configuration profile, NOT a live CDN access probe.
 */
export function createUploadedFilePublicationStorage(options: UploadedFilePublicationStorageOptions): UploadedFilePublicationStorage {
  const profile = Object.freeze({ ...options.deliveryProfile, cdnBaseUrl: publicationCdnBase(options.deliveryProfile?.cdnBaseUrl) });
  if (
    profile.mode !== 'external' ||
    typeof profile.id !== 'string' ||
    !profile.id.trim() ||
    profile.id.length > 256 ||
    publicationHasControlCharacter(profile.id)
  ) {
    throw new UploadedFilePublicationError('core.file.publication.not-configured');
  }
  const maxBytes = options.maxBytes ?? 20 * 1024 * 1024;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 100 * 1024 * 1024) {
    throw new UploadedFilePublicationError('core.file.publication.invalid-limit');
  }
  const expected = (intent: UploadedFilePublicationIntent): UploadedFilePublicationObjectMetadata => {
    const binding = publicationBinding(intent.binding);
    const source = publicationSource(intent.source);
    const target = { key: intent.target.key, url: intent.target.url, deliveryMode: intent.target.deliveryMode };
    if (
      target.deliveryMode !== 'external' ||
      typeof target.key !== 'string' ||
      !target.key ||
      target.key
        .split('/')
        .some((part) => !part || part === '.' || part === '..' || part.includes('\\') || publicationHasControlCharacter(part)) ||
      target.url !== profile.cdnBaseUrl + '/' + target.key.split('/').map(encodeURIComponent).join('/') ||
      !Number.isSafeInteger(source.size) ||
      source.size < 1 ||
      source.size > maxBytes ||
      !/^[a-f0-9]{64}$/.test(source.sha256) ||
      typeof source.version !== 'string' ||
      !source.version ||
      !/^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/.test(source.contentType) ||
      intent.descriptorHash !== publicationHash(JSON.stringify({ binding, source, target }))
    ) {
      throw new UploadedFilePublicationError('core.file.publication.invalid-descriptor');
    }
    return {
      descriptorHash: intent.descriptorHash,
      sha256: source.sha256,
      sourceVersion: source.version,
      size: source.size,
      contentType: source.contentType,
      deliveryProfileId: profile.id,
    };
  };
  const matches = (a: UploadedFilePublicationObjectMetadata, b: UploadedFilePublicationObjectMetadata) =>
    a.descriptorHash === b.descriptorHash &&
    a.sha256 === b.sha256 &&
    a.sourceVersion === b.sourceVersion &&
    a.size === b.size &&
    a.contentType === b.contentType &&
    a.deliveryProfileId === b.deliveryProfileId;
  const inspect: UploadedFilePublicationStorage['inspect'] = async (intent, signal) => {
    const meta = expected(intent);
    if (signal.aborted) return 'unknown';
    try {
      const found = await options.objects.headExact(intent.target.key, signal);
      if (signal.aborted || found === 'unknown') return 'unknown';
      if (found === null) return 'absent';
      return matches(found, meta) ? 'matching' : 'conflict';
    } catch {
      return 'unknown';
    }
  };
  return {
    inspect,
    async publish(intent, signal) {
      const meta = expected(intent);
      if (signal.aborted) return 'unknown';
      const before = await inspect(intent, signal);
      if (before === 'matching') return 'acknowledged';
      if (before !== 'absent' || signal.aborted) return 'unknown';
      const read = await options.readSource(intent.source, signal);
      if (signal.aborted) return 'unknown';
      if (
        !(read.bytes instanceof Uint8Array) ||
        read.version !== meta.sourceVersion ||
        read.bytes.byteLength !== meta.size ||
        read.bytes.byteLength > maxBytes
      ) {
        throw new UploadedFilePublicationError('core.file.publication.source-integrity');
      }
      const bytes = Buffer.from(read.bytes);
      if (createHash('sha256').update(bytes).digest('hex') !== meta.sha256) {
        throw new UploadedFilePublicationError('core.file.publication.source-integrity');
      }
      try {
        const written = await options.objects.putImmutable(intent.target.key, bytes, meta, signal);
        if (written !== 'acknowledged' || signal.aborted) return 'unknown';
        return (await inspect(intent, signal)) === 'matching' ? 'acknowledged' : 'unknown';
      } catch {
        return 'unknown';
      }
    },
    async removeExact(intent, signal) {
      const before = await inspect(intent, signal);
      if (before === 'absent') return 'acknowledged';
      if (before !== 'matching' || signal.aborted) return 'unknown';
      try {
        const removed = await options.objects.deleteExact(intent.target.key, intent.descriptorHash, signal);
        if (removed !== 'acknowledged' || signal.aborted) return 'unknown';
        return (await inspect(intent, signal)) === 'absent' ? 'acknowledged' : 'unknown';
      } catch {
        return 'unknown';
      }
    },
  };
}
