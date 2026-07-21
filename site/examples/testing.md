# Testing

Security mechanisms need negative tests, not only happy paths. Keep unit tests fast, then run
repository, feature, and scheduler tests against PostgreSQL semantics.

## Unit-test request context

```ts
import { ContextService } from '@sdcorejs/nestjs/core';

describe('ContextService', () => {
  it('isolates overlapping async contexts', async () => {
    const context = new ContextService();

    const [acme, beta] = await Promise.all([
      context.run({ tenant: 'ACME', userId: 'user-a' }, async () => {
        await Promise.resolve();
        return [context.tenant, context.userId];
      }),
      context.run({ tenant: 'BETA', userId: 'user-b' }, async () => {
        await Promise.resolve();
        return [context.tenant, context.userId];
      }),
    ]);

    expect(acme).toEqual(['ACME', 'user-a']);
    expect(beta).toEqual(['BETA', 'user-b']);
    expect(context.store).toBeUndefined();
  });
});
```
## E2E tenant and identity matrix

The following test uses two application-owned helpers:

- `createTestApplication(databaseUrl)` boots the real AppModule against a disposable database;
- `signTestToken(claims)` signs with the symmetric/JWKS test key trusted by that module.

They are explicit test-fixture placeholders, not library exports.

```ts
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

describe('product security', () => {
  let app: INestApplication;
  let acmeToken: string;
  let betaToken: string;

  beforeAll(async () => {
    app = await createTestApplication(process.env.TEST_DATABASE_URL!);
    acmeToken = await signTestToken({
      sub: '00000000-0000-4000-a000-000000000001',
      tenant: 'ACME',
      permissions: ['product:manage'],
    });
    betaToken = await signTestToken({
      sub: '00000000-0000-4000-a000-000000000002',
      tenant: 'BETA',
      permissions: ['product:manage'],
    });
  });

  afterAll(() => app.close());

  it('uses 0-based paging and returns Nest POST status 201', async () => {
    const response = await request(app.getHttpServer())
      .post('/products/paging')
      .auth(acmeToken, { type: 'bearer' })
      .send({ pageNumber: 0, pageSize: 500 })
      .expect(201);

    expect(response.body.data.items.length).toBeLessThanOrEqual(200);
    expect(
      response.body.data.items.every(
        (item: { tenantCode?: string }) => item.tenantCode === undefined,
      ),
    ).toBe(true);
  });

  it('does not reveal a BETA resource to ACME', async () => {
    const betaId = await seedProduct('BETA');

    await request(app.getHttpServer())
      .get('/products/' + betaId)
      .auth(acmeToken, { type: 'bearer' })
      .expect(200)
      .expect(({ body }) => expect(body.data).toBeNull());
  });

  it('rejects missing authentication', () =>
    request(app.getHttpServer()).post('/products/paging').send({}).expect(401));

  it('keeps DELETE status/body aligned with BaseController', async () => {
    const id = await seedProduct('ACME');
    await request(app.getHttpServer())
      .delete('/products/' + id)
      .auth(acmeToken, { type: 'bearer' })
      .expect(200)
      .expect({ data: null });
  });
});
```

`seedProduct` is another application fixture and must insert through a known tenant setup. The
detail contract returns `{ data: null }` for a scoped miss; feature services such as uploaded files
and action history deliberately use non-enumerating 404 responses instead.

## Trusted-gateway negatives

If tests use trusted identity headers instead of JWT, the test module must configure an actual test
proof:

```ts
trustedHeaders: {
  isTrustedRequest: (request) =>
    request.headers['x-test-gateway-proof'] === process.env.TEST_GATEWAY_PROOF,
},
```

Then assert that `X-Tenant` without the correct proof returns 401. Never configure
`isTrustedRequest: () => true`; that masks the production trust boundary.

## Use PostgreSQL where behavior is PostgreSQL-specific

An in-memory TypeORM fake cannot prove:

- `UNACCENT` search and PostgreSQL casts/order syntax;
- jsonb/enum/timestamptz mappings;
- `ON CONFLICT ... RETURNING` job claims;
- database-clock lease expiry and interval casts; or
- real transaction/unique-index races.

Use a disposable PostgreSQL container/database in CI for those tests. A pg-mem suite is useful as a
fast compatibility layer but is not evidence of full PostgreSQL concurrency semantics.

## Stateful feature cases

Uploaded files:

- object write failure leaves a hidden pending row;
- activation plus cleanup failure remains retryable;
- pending rows are not readable;
- cross-tenant/owner reads return the same 404;
- cleanup succeeds later without exposing unsafe maintenance APIs to HTTP.

Job scheduler:

- N concurrent acquires for one run produce one winner;
- stale reclaim changes owner token but preserves idempotency key;
- the old owner cannot heartbeat or finalize;
- invalid SCHEDULE/INITIAL identity fails before SQL.

Action history:

- scope is copied from the persisted resource;
- omitted/denied policy returns 404;
- password/token fields are recursively redacted;
- pages start at 0 and cannot exceed 200.

## Delivery gates

Run the same clean-install and verification set used by the release workflow:

```bash
npm ci
npm ci --prefix site
npm run lint
npm run format:check
npm run typecheck
npm run examples:typecheck
npm run test:coverage
npm run build
npm run check:package-di
npm run check:exports
npm pack --dry-run
npm run docs:check
npm audit
npm audit --prefix site
```
