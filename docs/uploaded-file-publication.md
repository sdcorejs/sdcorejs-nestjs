# Shared attachment publication

The existing `@sdcorejs/nestjs/features` entrypoint exports
`UPLOADED_FILE_PUBLICATION_API_VERSION = 1`,
`createUploadedFilePublicationCoordinator`,
`createUploadedFilePublicationStorage`, and
`runUploadedFilePublicationConformance`.

This is an opt-in neutral capability. It adds no HTTP route, automatic worker, entity,
database connection, bucket, credential, ACL policy or default public visibility.
Existing UploadedFileService uploads and markUsed behavior are unchanged.
Consumers supply their existing durable domain repository and transport through public ports.
They must not copy this coordinator or import internal package bundles.

## Authorization and transaction boundary

The policy resolves a valid assignment inside its domain transaction, after existing
authorization and version/conflict checks. Input must not be a client's visibility flag,
URL, object key, owner claim or raw uploaded-file DTO. Resolve the authoritative upload row
and its immutable version, digest, byte count, MIME type and private locator.

A binding is `environment/module/scopeId/bindingId/generation`. Scope values are neutral
strings, not UUID-only. Every replacement, including replacement by the same file, gets
a new immutable generation. Module names must be in the configured allowlist and the
binding environment must equal the configured environment. These checks also apply to
private cleanup, retirement and URL projection. CDN configuration is not needed to retire
an authorized private binding.

Call `coordinator.stage(assignment, transaction)` in the SAME transaction as assigning the
file to its domain record. The repository stage primitive stores an immutable intent and
retires superseded generations while the assignment row remains locked. Retrying the same
binding generation/source/configuration returns the first stored intent; a changed
descriptor for that generation must fail and roll back. Core's descriptorHash excludes
random intent id and createdAt so transaction retries remain idempotent.

Private assignments call `retireLogicalBinding`, not just retirement of the new generation:
public generation G1 followed by private G2 must hide and retire G1. Explicit unlink can call
`retire(exactBinding, transaction)`. Unlink immediately removes the URL projection in that
transaction, before external object deletion. Do not mutate a private original's ACL.

## Configuration and immutable keys

The consumer maps its operator-requested `CDN_BASE_URL` and
`FILE_PUBLIC_ACCESS_MODE=external` into the Core config. Other/missing modes fail closed
when staging public content. No endpoint-derived CDN fallback exists. Literal query/fragment delimiters, including
empty `?` or `#`, are rejected; legitimate HTTPS base paths remain supported.

Example neutral config:

```ts
{
  environment: 'dev',
  keyPrefix: '', // explicitly empty means no extra root
  modulePrefixes: { administration: 'app-administration' },
  cdnBaseUrl: 'https://cdn.example.test',
  deliveryMode: 'external',
}
```

Core constructs:
`[keyPrefix/]environment/modulePrefix/public/encodedScope/bindingGenerationHash/sourceSha256`.
The optional prefix is validated segment by segment; empty/traversal/control segments are
rejected. No caller-controlled destination path is accepted. URL escaping describes the
exact object key, including literal percent escapes in encoded scope segments.

Intent target, source and binding are immutable snapshots. The worker rederives the key,
URL and descriptor digest before any object access. Changing CDN/prefix configuration is
not a migration: old intent retirement must retain its matching configured profile.
Plan such transitions explicitly; do not silently reinterpret stored keys.

## Durable repository responsibilities

The public repository port is a small set of transactional/CAS primitives. It is not an
in-memory production implementation and must not own a second publication engine.

- `stage`: atomic domain assignment + unique immutable intent; retire superseded generations.
- `retireLogicalBinding` / `retire`: hide projection and retain cleanup tombstones.
- `claim`: claim due work with token/revision/lease. Persist uncertain external outcome
  BEFORE returning publish work. Never steal a live lease. Ready/blocked records are not
  publishable. Retired tombstones remain eligible for reconciliation.
- `isCurrent`: preflight only.
- `commitReady`: in one transaction recheck current valid assignment, identical
  source/generation, exact id/hash/token/revision and unexpired lease at actual commit time.
  Only then persist ready and the intent URL. Return stale while retaining the lease for
  cleanup, or lost without touching a newer worker.
- `record`: exact fenced transition/retry and lease release. Never overwrite a newer lease.
- `readCurrent`: resolve the current domain binding, not only file id; replaced/unlinked
  bindings return null. Core exposes a URL only for verified ready state.

Persist intent/source/target/hash, state, lease token/revision/deadline and next-attempt time.
Use a unique binding-generation constraint and an atomic current-binding predicate. A
lost DB acknowledgement can mean ready already committed: never delete its object just
because the acknowledgement was lost. Core retains durable reconciliation state.

## Shared byte/object adapter

Use `createUploadedFilePublicationStorage` for both consumers. It verifies source version,
SHA-256 and exact byte size centrally, writes immutable metadata, verifies matching HEAD
after acknowledged writes, and checks exact metadata before deletion.

Consumer ports only bridge their trusted transport:

- `readSource`: authorized exact private source read, bounded before buffering.
- `headExact`: authoritative metadata for the exact key, null for known absence, unknown
  for uncertainty. SHA-256 must come from provider-verified data or a trusted immutable
  write path, never arbitrary caller headers.
- `putImmutable`: conditional creation only. A mismatching existing object is a conflict.
- `deleteExact`: compare descriptor and use provider version/ETag conditional deletion.
  A HEAD followed by unconditional DELETE is insufficient. If conditional deletion cannot
  be guaranteed, return unknown and keep cleanup pending.

The `deliveryProfile` contains `id/cdnBaseUrl/mode:external`. Its identity may be a hash of
requested configuration. It is NOT an attestation that CDN infrastructure was provisioned,
a proof of public reachability, or a replacement for operator configuration. Matching
means verified object metadata plus the configured profile, not a live CDN HTTP test.
The library neither probes a public CDN nor creates credentials, policies or ACLs.

Consumer content validation remains mandatory before assignment. The shared helper checks
the declared immutable bytes, not semantic image decoding, malware scanning or domain
publication permission. Its default bound is 20 MiB, configurable up to 100 MiB.

## Worker uncertainty, deadlines and retirement

Invoke `run(intentId)` from an existing owned worker. No new queue/cron is automatically
mounted. Work first reconciles the exact rendition. Unknown HEAD never means absence;
unknown PUT never makes a URL visible. A matching rendition can reconcile a lost PUT ack
without writing again.

Worker port waits are bounded by leaseMs. A deadline returns pending with the durable claim
uncertainty intact; an AbortSignal is a cancellation request, NOT proof the remote request
was cancelled. A late promise result cannot execute a ready transition after timeout.
Expired/stolen leases cannot overwrite new ownership. A stale assignment queues retirement.

Retain and periodically reconcile retirement tombstones even after known absence/deletion:
an abandoned PUT can arrive late. Remove only the exact public rendition. Never delete the
private source. Retiring a URL/object cannot recall already cached or downloaded public
content. No report may promise cache recall.

## Consumer capability detection

Old installed package versions do not have these factories. Consumers may inspect the
public features namespace for sentinel version 1 and callable factories. If publication is
enabled but unsupported, fail before committing the domain assignment. Do not alias package
imports to another repository in production, import private chunks, or duplicate the engine.
Local tests may inject this exact candidate source with a recorded candidate identity.

Introduced in the 1.3 minor release. Consumers must pin a released package containing this capability before enabling publication; local injection is test evidence only.

## Shared conformance

`runUploadedFilePublicationConformance(factory)` runs twelve synthetic vectors against
the consumer repository adapter. The fixture factory receives a clock and supplies
repository, withAssignment transaction, inspectIntent, and optional dispose. Each vector
gets a fresh isolated fixture. Never pass a production repository.

An optional `fixture.profile` provides schema-compatible synthetic `binding`,
`replacementGeneration`, `source` (id/version/locator/contentType), and `modulePrefix`.
All fields are required when a profile is supplied and are validated before repository
mutation. It derives the worker namespace/configuration without rewriting descriptors or
relaxing domain constraints. Defaults use deterministic UUID-shaped record identifiers;
Core public scope/binding contracts still accept safe neutral strings. The fixture bytes
are the UTF-8 string `synthetic-publication-source`; the shared helper derives its exact
size and SHA-256. This is repository/transport conformance, not image-content validation.

The same twelve vectors run with any valid profile, including namespace and foreign-scope
negative assertions. A foreign scope must return no URL; invalid profile data must fail
before repository mutation. Consumer actor/ownership authorization must be tested through
its actual assignment policy separately because this neutral Core repository port has no
actor context. Do not claim actor isolation from the generic vectors.

Covered: default private; acknowledgement-before-URL; idempotent staging; generation
conflict; lost PUT ack; unknown HEAD; replacement during PUT; unlink visibility; public G1
to private G2; late PUT after retirement; stale lease CAS; unknown deletion retry.
Adjacent Core unit tests additionally cover namespaces, source integrity, foreign object
conflicts, malformed CDN config, conditional deletion and never-resolving/late ports.

Passing synthetic tests does not establish real PostgreSQL transaction behavior, actual DO
conditional-write/delete support, bucket policy, CDN access or cache behavior. Those require
separately authorized environment-specific integration evidence.
