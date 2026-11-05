# Temporary Core release-tooling exception

Historical record only. This exception expired and was removed from the active gate
for 1.3.1. Its unchanged policy is archived in
`release-audit-exception-20261028.policy.json`. Current releases require zero findings
in the repository, production, docs, fresh-consumer and upgrade-consumer trees.

Approved for one reviewed 1.3.0 release; expires 2026-11-04T09:30:00Z, review before 2026-10-30T09:30:00Z. Only GHSA-gcqx-w48m-w2h4 through the exact locked dev chain may return ACCEPTED_WITH_TIME_LIMITED_EXCEPTION. Production/docs audit and packed runtime stay clean. The full audit report and raw exit are retained. Source, package version, lock classification/integrity, advisory/edge/severity drift, invalid report or expiry fail closed. This is not a runtime vulnerability fix, a DEV restriction on the public npm package, or an exception for any other release/consumer. Never use continue-on-error or global audit-level reduction. Remove or explicitly re-review this policy before later releases.
