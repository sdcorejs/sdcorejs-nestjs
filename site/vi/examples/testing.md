# Kiểm thử {#testing}

Cơ chế bảo mật cần negative test, không chỉ happy path. Giữ unit test chạy nhanh, sau đó chạy test
repository, feature và scheduler theo ngữ nghĩa PostgreSQL.

## Unit test request context {#unit-test-request-context}

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
## Ma trận E2E tenant và danh tính {#e2e-tenant-and-identity-matrix}

Test sau dùng hai helper thuộc về ứng dụng:

- `createTestApplication(databaseUrl)` khởi động AppModule thật với cơ sở dữ liệu dùng một lần;
- `signTestToken(claims)` ký bằng symmetric/JWKS test key được module đó tin cậy.

Đây là placeholder test fixture rõ ràng, không phải export của thư viện.

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

`seedProduct` là một fixture khác của ứng dụng và phải insert qua thiết lập tenant đã biết. Hợp đồng
detail trả `{ data: null }` khi không khớp scope; các feature service như tệp đã tải lên và lịch sử
thao tác chủ đích dùng response 404 không cho phép suy đoán tài nguyên.

## Negative test cho trusted gateway {#trusted-gateway-negatives}

Nếu test dùng trusted identity header thay vì JWT, test module phải cấu hình bằng chứng kiểm thử thật:

```ts
trustedHeaders: {
  isTrustedRequest: (request) =>
    request.headers['x-test-gateway-proof'] === process.env.TEST_GATEWAY_PROOF,
},
```

Sau đó assert rằng `X-Tenant` không có bằng chứng chính xác sẽ trả về 401. Không bao giờ cấu hình
`isTrustedRequest: () => true`; cách đó che khuất ranh giới tin cậy production.

## Dùng PostgreSQL khi hành vi phụ thuộc PostgreSQL {#use-postgresql-where-behavior-is-postgresql-specific}

TypeORM fake trong bộ nhớ không thể chứng minh:

- tìm kiếm `UNACCENT` và cú pháp cast/order PostgreSQL;
- mapping jsonb/enum/timestamptz;
- job claim `ON CONFLICT ... RETURNING`;
- hết hạn lease theo đồng hồ cơ sở dữ liệu và interval cast; hoặc
- race transaction/unique index thật.

Dùng container/cơ sở dữ liệu PostgreSQL dùng một lần trong CI cho các test này. Bộ test pg-mem hữu
ích như một lớp tương thích nhanh nhưng không phải bằng chứng về toàn bộ ngữ nghĩa concurrency của
PostgreSQL.

## Trường hợp cho tính năng có state {#stateful-feature-cases}

Tệp đã tải lên:

- object write thất bại để lại hàng pending bị ẩn;
- activation cộng với cleanup thất bại vẫn có thể retry;
- hàng pending không thể đọc;
- lần đọc khác tenant/chủ sở hữu trả cùng mã 404;
- cleanup thành công sau đó mà không expose maintenance API không an toàn qua HTTP.

Job scheduler:

- N lần acquire đồng thời cho một run chỉ tạo ra một winner;
- stale reclaim thay owner token nhưng giữ nguyên idempotency key;
- owner cũ không thể heartbeat hoặc finalize;
- định danh SCHEDULE/INITIAL không hợp lệ thất bại trước SQL.

Lịch sử thao tác:

- scope được sao chép từ resource đã lưu;
- policy bị bỏ qua/từ chối trả về 404;
- field password/token được redaction đệ quy;
- trang bắt đầu từ 0 và không thể vượt quá 200.

## Delivery gate {#delivery-gates}

Chạy cùng bộ clean install và xác minh được release workflow sử dụng:

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
