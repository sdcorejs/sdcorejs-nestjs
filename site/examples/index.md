# Examples

These recipes use only the eight supported package entry points. Each page states when a symbol is
application-owned rather than a library API.

| Example | What it demonstrates |
| --- | --- |
| [Complete application](/examples/complete-app) | end-to-end module, entity, repository, service, controller |
| [Tenant CRUD](/examples/tenant-crud) | scoped base ORM stack, paging, actual HTTP statuses |
| [Identity and permissions](/examples/identity-and-permissions) | verified principal mapping and route permissions |
| [Cache and HTTP](/examples/cache-and-http) | mandatory interceptor, cache isolation, trusted origins |
| [Uploads](/examples/uploaded-files) | S3/local configuration, private controller, attach/delete lifecycle |
| [Action history](/examples/action-history) | automatic snapshots, redaction, authorized reads |
| [Scheduled jobs](/examples/scheduled-jobs) | stable idempotency key and transactional-outbox shape |
| [Testing](/examples/testing) | unit/integration/E2E security assertions |

Snippets are intentionally small enough to adapt. Values such as domain permission names, Keycloak
issuer URLs, storage buckets, and entity fields remain application policy.
