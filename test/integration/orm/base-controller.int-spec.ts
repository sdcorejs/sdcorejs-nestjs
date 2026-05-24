import 'reflect-metadata';
import { Controller, Injectable, Module, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { DataSource } from 'typeorm';
import request from 'supertest';
import { BaseController } from '../../../src/orm/base-controller';
import { BaseService } from '../../../src/orm/base-service';
import { createTestDataSource } from '../../fixtures/pg-mem-datasource';
import { TestProduct } from '../../fixtures/test-product.entity';
import { TestProductRepository } from '../../fixtures/test-product.repository';

interface TestProductDto {
  id: string;
  code?: string;
  name?: string;
  deletable?: boolean;
  restorable?: boolean;
}

@Injectable()
class TestProductService extends BaseService<TestProduct, TestProductDto> {
  mapDTO(e: TestProduct | undefined | null): TestProductDto | null {
    if (!e) return null;
    return { id: e.id, code: e.code, name: e.name, deletable: true, restorable: true };
  }
}

@Controller('test-products')
class TestProductController extends BaseController<TestProduct, TestProductDto> {
  constructor(svc: TestProductService) {
    super(svc);
  }
}

describe('BaseController (HTTP integration)', () => {
  let app: INestApplication;
  let ds: DataSource;

  beforeAll(async () => {
    ds = await createTestDataSource([TestProduct]);
    await ds.getRepository(TestProduct).save([
      { code: 'C1', name: 'Foo', isActive: true },
      { code: 'C2', name: 'Bar', isActive: true },
    ]);

    @Module({
      controllers: [TestProductController],
      providers: [
        { provide: TestProductRepository, useFactory: () => new TestProductRepository(ds) },
        { provide: TestProductService, useFactory: (r: TestProductRepository) => new TestProductService(r), inject: [TestProductRepository] },
      ],
    })
    class TestModule {}

    const mod = await Test.createTestingModule({ imports: [TestModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await ds?.destroy();
  });

  it('POST /test-products/paging returns ApiResponse envelope', async () => {
    const res = await request(app.getHttpServer())
      .post('/test-products/paging')
      .send({ pageNumber: 0, pageSize: 10 });
    expect(res.status).toBe(201);
    expect(res.body.data.total).toBe(2);
    expect(res.body.data.items).toHaveLength(2);
  });

  it('GET /test-products/all returns ApiResponse', async () => {
    const res = await request(app.getHttpServer()).get('/test-products/all');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
  });

  it('GET /test-products/:id returns single entity', async () => {
    const [first] = await ds.getRepository(TestProduct).find();
    const res = await request(app.getHttpServer()).get(`/test-products/${first.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.code).toBe(first.code);
  });

  it('POST /test-products/search returns ApiResponse', async () => {
    const res = await request(app.getHttpServer())
      .post('/test-products/search?keyword=Foo')
      .send([]);
    expect(res.status).toBe(201);
    expect(res.body.data).toHaveLength(1);
  });

  it('DELETE /test-products/:id/soft returns noContent envelope', async () => {
    const [first] = await ds.getRepository(TestProduct).find();
    const res = await request(app.getHttpServer()).delete(`/test-products/${first.id}/soft`);
    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
  });

  it('POST /test-products/paging/deleted includes the soft-deleted row', async () => {
    const res = await request(app.getHttpServer())
      .post('/test-products/paging/deleted')
      .send({ pageNumber: 0, pageSize: 10 });
    expect(res.status).toBe(201);
    expect(res.body.data.total).toBe(2);
  });

  it('PUT /test-products/:id/restore returns noContent', async () => {
    const [first] = await ds.getRepository(TestProduct).find();
    const res = await request(app.getHttpServer()).put(`/test-products/${first.id}/restore`);
    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
  });
});
