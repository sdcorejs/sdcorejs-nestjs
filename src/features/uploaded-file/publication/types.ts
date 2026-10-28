/** Runtime capability detection; consumers must fail closed when enabled but unavailable. */
export const UPLOADED_FILE_PUBLICATION_API_VERSION = 1 as const;

/** Trusted domain assignment, resolved server-side inside its transaction. */
export interface UploadedFilePublicationBinding {
  environment: string;
  module: string;
  scopeId: string;
  bindingId: string;
  /** Fresh immutable generation on every replacement, even when reusing the same file. */
  generation: string;
}

/** Snapshot of a validated immutable private source; locator is opaque to Core. */
export interface UploadedFilePublicationSource {
  id: string;
  version: string;
  locator: string;
  sha256: string;
  size: number;
  contentType: string;
}

export interface UploadedFilePublicationConfig {
  environment: string;
  keyPrefix: string;
  modulePrefixes: Readonly<Record<string, string>>;
  /** Explicit HTTPS delivery base; never inferred from the object-store endpoint. */
  cdnBaseUrl?: string;
  /** No ACL mutation in this capability. */
  deliveryMode?: 'external';
  leaseMs?: number;
  retryMs?: number;
}

export interface UploadedFilePublicationIntent {
  id: string;
  binding: Readonly<UploadedFilePublicationBinding>;
  source: Readonly<UploadedFilePublicationSource>;
  target: Readonly<{ key: string; url: string; deliveryMode: 'external' }>;
  descriptorHash: string;
  createdAt: number;
}
export type UploadedFilePublicationState = 'pending' | 'uncertain' | 'ready' | 'retiring' | 'retired' | 'blocked';
export interface UploadedFilePublicationLease {
  intent: UploadedFilePublicationIntent;
  token: string;
  revision: number;
  leaseUntil: number;
  action: 'publish' | 'retire';
}

export interface UploadedFilePublicationPolicy<Assignment = unknown, Transaction = unknown> {
  /** Private by default. Resolve with the domain assignment transaction/lock held. */
  resolve(
    assignment: Assignment,
    transaction: Transaction,
  ): Promise<
    | { visibility: 'private'; binding: UploadedFilePublicationBinding }
    | { visibility: 'public'; binding: UploadedFilePublicationBinding; source: UploadedFilePublicationSource }
  >;
}

/** Durable persistence primitives; every CAS is fenced by id, descriptorHash, token and revision. */
export interface UploadedFilePublicationRepository<Transaction = unknown> {
  /**
   * SAME transaction as valid assignment: insert immutable intent, hide/retire superseded
   * generations. Unique binding generation makes retry idempotent. Conflicting descriptors fail.
   */
  stage(transaction: Transaction, intent: UploadedFilePublicationIntent): Promise<UploadedFilePublicationIntent>;
  /** Retire every generation for a logical binding when assigning a private file or clearing it. */
  retireLogicalBinding(transaction: Transaction, binding: Omit<UploadedFilePublicationBinding, 'generation'>): Promise<void>;
  /** Hide the exact generation's projection immediately and retain a retirement tombstone. */
  retire(transaction: Transaction, binding: UploadedFilePublicationBinding): Promise<void>;
  /**
   * Atomically claim due work. Record uncertain external outcome BEFORE returning publish work.
   * A live lease cannot be stolen. Ready/blocked records are not publishable.
   * Retired tombstones remain reconcilable: an abandoned PUT may arrive after its lease.
   */
  claim(id: string, claim: { token: string; now: number; leaseUntil: number }): Promise<UploadedFilePublicationLease | null>;
  /** Preflight only; commitReady repeats this atomically. */
  isCurrent(work: UploadedFilePublicationLease): Promise<boolean>;
  /**
   * Atomically require CURRENT valid assignment, identical source/generation, unexpired lease
   * and CAS fence, then persist ready + intent.target.url. Stale keeps this lease for retirement.
   * Lost must never change a newer lease or its ready projection.
   */
  commitReady(work: UploadedFilePublicationLease, now: number): Promise<'ready' | 'stale' | 'lost'>;
  /** Release exact fenced lease, persist state/retry. False means a newer owner; do not overwrite. */
  record(
    work: UploadedFilePublicationLease,
    result: {
      state: Exclude<UploadedFilePublicationState, 'ready'>;
      code: string;
      nextAttemptAt: number;
    },
  ): Promise<boolean>;
  /** Query the CURRENT domain binding/generation. Replaced/unlinked bindings return null. */
  readCurrent(binding: UploadedFilePublicationBinding): Promise<{
    intent: UploadedFilePublicationIntent;
    state: UploadedFilePublicationState;
  } | null>;
}

export interface UploadedFilePublicationStorage {
  /**
   * Create a SEPARATE rendition at the exact target; original remains private. Verify immutable
   * source digest/version/size and safe content metadata. Never change ACL or overwrite mismatch.
   * Acknowledged means exact bytes and the configured delivery profile match; no live CDN probe. Respect deadline signal.
   */
  publish(intent: UploadedFilePublicationIntent, signal: AbortSignal): Promise<'acknowledged' | 'unknown'>;
  /** Match exact object/source descriptor AND configured delivery profile. Unknown is not absence. */
  inspect(intent: UploadedFilePublicationIntent, signal: AbortSignal): Promise<'matching' | 'absent' | 'unknown' | 'conflict'>;
  /** Remove only this rendition, never private source. Acknowledgement cannot recall CDN caches. */
  removeExact(intent: UploadedFilePublicationIntent, signal: AbortSignal): Promise<'acknowledged' | 'unknown'>;
}

export interface UploadedFilePublicationOptions<Assignment = unknown, Transaction = unknown> {
  config: UploadedFilePublicationConfig;
  policy: UploadedFilePublicationPolicy<Assignment, Transaction>;
  repository: UploadedFilePublicationRepository<Transaction>;
  storage: UploadedFilePublicationStorage;
  clock?: () => number;
  newId?: () => string;
}
export interface UploadedFilePublicationCoordinator<Assignment = unknown, Transaction = unknown> {
  stage(assignment: Assignment, transaction: Transaction): Promise<{ visibility: 'private' | 'public'; intentId: string | null }>;
  retire(binding: UploadedFilePublicationBinding, transaction: Transaction): Promise<void>;
  run(intentId: string): Promise<'idle' | 'ready' | 'pending' | 'retired' | 'blocked' | 'lost'>;
  project(binding: UploadedFilePublicationBinding): Promise<{ url: string | null; state: UploadedFilePublicationState | 'private' }>;
}

/** Operator-requested delivery configuration; this is NOT proof of a live CDN HTTP response. */
export interface UploadedFilePublicationDeliveryProfile {
  id: string;
  cdnBaseUrl: string;
  mode: 'external';
}
export interface UploadedFilePublicationObjectMetadata {
  descriptorHash: string;
  sha256: string;
  sourceVersion: string;
  size: number;
  contentType: string;
  deliveryProfileId: string;
}
export interface UploadedFilePublicationObjectPort {
  /**
   * HEAD/authoritative lookup of the exact immutable object. SHA256 must be provider-verified or
   * recorded by a trusted immutable write path; an unverified caller header is not evidence.
   */
  headExact(key: string, signal: AbortSignal): Promise<UploadedFilePublicationObjectMetadata | null | 'unknown'>;
  /** Conditional create only. Never overwrite. Report ambiguous outcomes as unknown, not failure. */
  putImmutable(
    key: string,
    bytes: Uint8Array,
    metadata: UploadedFilePublicationObjectMetadata,
    signal: AbortSignal,
  ): Promise<'acknowledged' | 'unknown' | 'conflict'>;
  /** Conditional exact-object deletion; refuse mismatching descriptors. Compare HEAD metadata then use
   * provider version/ETag precondition. Without conditional deletion support return unknown; a
   * HEAD check followed by unconditional deletion is insufficient. */
  deleteExact(key: string, expectedDescriptorHash: string, signal: AbortSignal): Promise<'acknowledged' | 'unknown' | 'conflict'>;
}
export interface UploadedFilePublicationStorageOptions {
  /** Read the authorized original, preserving its private ACL. Bound reads before buffering. */
  readSource(source: Readonly<UploadedFilePublicationSource>, signal: AbortSignal): Promise<{ bytes: Uint8Array; version: string }>;
  objects: UploadedFilePublicationObjectPort;
  deliveryProfile: UploadedFilePublicationDeliveryProfile;
  maxBytes?: number;
}
