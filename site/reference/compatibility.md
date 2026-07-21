# Compatibility

| Area | Supported/tested contract |
| --- | --- |
| Node.js | `>=20`; CI targets current Node 20.x and 22.x |
| NestJS | `@nestjs/common` and `@nestjs/core` `^11` peers |
| TypeORM | `0.3.x` dependency line |
| Module formats | Node ESM and CommonJS with matching declarations |
| Database | PostgreSQL-specific feature implementation; unit/integration tests use `pg-mem` |
| Validation | Zod v4 when validation helpers are used |
| Queue | BullMQ v5 through `@nestjs/bullmq` v11 |
| S3 | AWS SDK v3 client; no claim for every S3-compatible provider |
| OIDC | `passport-jwt`, `jwks-rsa`, `jsonwebtoken`; issuer policy required |

The automated suite does not currently run live PostgreSQL, Redis, Keycloak, or S3 services. It
uses focused adapters/mocks and PostgreSQL emulation. Validate your exact infrastructure in the host
application, especially object-store conditional writes, proxy trust, Redis topology, OIDC claims,
and migration SQL.

## Documentation tooling exception

The stable VitePress 1.6 line declares a Vite 5 range whose latest compatible release has unresolved
development-server advisories. The documentation workspace pins an audit-clean Vite 6 release via
an npm override; this is outside VitePress's declared range but is covered by clean install, audit,
and production docs-build gates. Revisit the override when a stable, supported, audit-clean upstream
combination exists.
