# Error catalog

HTTP-facing errors use `{ code, message, data? }` inside Nest's response shape. With
`SdI18nExceptionFilter`, `message` and validation issue messages are translated from the built-in
English/Vietnamese catalogs plus application overrides.

| Code | Typical status | Meaning |
| --- | ---: | --- |
| `core.validation.failed` | 400 | One or more Zod sources failed |
| `core.validation.uuid` | 400 | Invalid UUID preset |
| `core.validation.page-number.min` | 400 | Page number is below zero |
| `core.validation.page-size.min` | 400 | Page size is below one |
| `core.validation.page-size.max` | 400 | Page size exceeds 200 |
| `core.permission.forbidden` | 403 | Required permission is absent |
| `core.permission.internal-secret-missing` | 403 | Internal secret header is missing |
| `core.permission.internal-secret-mismatch` | 403 | Internal secret does not match any active key |
| `core.permission.internal-secret-provider-missing` | 500 | Internal guard has no secret provider |
| `core.context.verified-principal-missing` | 401 | A verified principal is required |
| `core.context.verified-principal-invalid` | 401 | Principal mapping did not yield trusted identity |
| `core.context.identity-conflict` | 401 | JWT and trusted-gateway identity conflict |
| `core.repository.invalid-uuid` | 400 | Repository mutation/detail ID is invalid |
| `core.repository.invalid-field-name` | 400 | Filter field syntax is unsafe |
| `core.repository.invalid-sort-field` | 400 | Sort field syntax is unsafe |
| `core.repository.column-not-found` | 400 | Resolved entity column does not exist |
| `core.repository.relation-not-found` | 400 | Requested relation does not exist |
| `core.repository.relation-not-found-in` | 400 | Nested relation is invalid |
| `core.repository.column-not-found-in` | 400 | Nested relation column is invalid |
| `core.repository.not-found` | 404 | Scoped mutation/resource did not match exactly |
| `core.file.empty` | 400 | Multipart controller received no file |
| `core.file.invalid-meta` | 400 | Upload metadata failed bounds/type validation |
| `core.file.invalid-upload` | 400 | Size, MIME, extension, signature, or name validation failed |
| `core.file.upload-failed` | 400 | Persistence/storage/activation failed without leaking internals |
| `core.file.not-found` | 404 | Missing, malformed, unauthorized, or cross-scope file |
| `core.file.remote-disabled` | 400 | Remote clone is not explicitly enabled |
| `core.file.remote-fetch-failed` | 400 | Hardened remote fetch rejected or failed |
| `core.file.temporary-cleanup-required` | 400 | Temporary uploads lack positive cleanup retention |
| `core.file.delete-failed` | 400 | Object deletion remains durably pending |
| `core.file.cleanup-failed` | 400 | Maintenance purge did not finish |
| `core.history.not-found` | 404 | History read is missing or unauthorized |
| `core.cache.invalid-redis-key-prefix` | startup | Redis prefix is blank or contains glob metacharacters |

## Typed operational errors

Some fail-closed conditions are typed errors rather than localized HTTP codes: tenancy errors
(`MissingTenancyContextError`, `MissingTenancyScopeError`, `InvalidTenancyScopeError`,
`TenancyScopeMutationError`, `UnauthorizedTenancyBypassError`), transaction misuse
(`InactiveMutationTransactionError`), job identity/timing/lease errors, history scope/snapshot-limit
errors, and invalid Redis prefix. Convert them at an application boundary only when you can preserve
the non-enumerating security semantics.
