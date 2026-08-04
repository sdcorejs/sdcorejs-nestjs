import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Readable } from 'node:stream';
import request from 'supertest';
import { AuthGuard } from '../../auth/permission/auth.guard';
import { ABSOLUTE_MAX_UPLOAD_BYTES } from './config';
import { UploadedFileService } from './services/uploaded-file.service';
import { UploadedFileController } from './uploaded-file.controller';

describe('UploadedFileController request limits', () => {
  let app: INestApplication;
  const service = {
    upload: jest.fn(async () => ({ id: 'file-id', fileName: 'a.txt', key: 'k', cdn: 'c' })),
    initiateUpload: jest.fn(async (input: unknown) => ({
      id: '00000000-0000-4000-8000-000000000001',
      status: 'pending',
      upload: { method: 'PUT', url: 'https://upload.test', headers: { 'content-type': 'text/plain' }, expiredAt: new Date() },
      input,
    })),
    initiateTemporaryUpload: jest.fn(async (input: unknown) => ({
      id: '00000000-0000-4000-8000-000000000002',
      status: 'pending',
      upload: { method: 'PUT', url: 'https://upload.test/temp', headers: {}, expiredAt: new Date() },
      input,
    })),
    completeUpload: jest.fn(async () => ({
      id: '00000000-0000-4000-8000-000000000001',
      originalName: 'a.txt',
      contentType: 'text/plain',
      size: 5,
      visibility: 'private',
      status: 'ready',
      isTemporary: false,
      completedAt: new Date(),
      expiredAt: null,
      disposition: 'attachment',
      url: 'https://download.test/signed',
      urlExpiredAt: new Date(),
      fileName: 'a.txt',
      fileSize: 0,
      key: 'secret/object/key',
      cdn: 'secret-persisted-url',
    })),
    find: jest.fn(async () => service.completeUpload()),
    deleteById: jest.fn(async () => undefined),
    putUploadContent: jest.fn(async () => service.completeUpload()),
    download: jest.fn(async () => ({ stream: Readable.from('hello'), fileName: 'a.txt' })),
    getContent: jest.fn(() => ({ ContentType: 'text/plain' })),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [UploadedFileController],
      providers: [{ provide: UploadedFileService, useValue: service }],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication();
    await app.init();
  });

  afterAll(async () => app.close());
  beforeEach(() => jest.clearAllMocks());

  it('passes a bounded single buffered file and declared MIME to the secure service', async () => {
    await request(app.getHttpServer())
      .post('/uploaded-file')
      .attach('file', Buffer.from('hello'), {
        filename: 'a.txt',
        contentType: 'text/plain',
      })
      .expect(201);
    expect(service.upload).toHaveBeenCalledWith(expect.any(Buffer), 'a.txt', expect.any(Object), undefined, { contentType: 'text/plain' });
  });

  it('rejects an oversized multipart file before the service sees it', async () => {
    await request(app.getHttpServer())
      .post('/uploaded-file')
      .attach('file', Buffer.alloc(ABSOLUTE_MAX_UPLOAD_BYTES + 1), { filename: 'large.bin', contentType: 'application/octet-stream' })
      .expect(413);
    expect(service.upload).not.toHaveBeenCalled();
  });

  it('rejects extra files and excessive multipart fields', async () => {
    await request(app.getHttpServer())
      .post('/uploaded-file')
      .attach('file', Buffer.from('one'), 'one.txt')
      .attach('file', Buffer.from('two'), 'two.txt')
      .expect(400);

    await request(app.getHttpServer())
      .post('/uploaded-file')
      .field('one', '1')
      .field('two', '2')
      .field('three', '3')
      .field('four', '4')
      .field('five', '5')
      .attach('file', Buffer.from('one'), 'one.txt')
      .expect(400);
    expect(service.upload).not.toHaveBeenCalled();
  });

  it('sets a derived content type and disables browser MIME sniffing on downloads', async () => {
    await request(app.getHttpServer())
      .get('/uploaded-file/00000000-0000-4000-8000-000000000001/download')
      .expect(200)
      .expect('Content-Type', /text\/plain/)
      .expect('X-Content-Type-Options', 'nosniff')
      .expect('Content-Disposition', /attachment/);
  });

  it('exposes provider-neutral permanent and temporary initiate endpoints without accepting visibility or TTL', async () => {
    await request(app.getHttpServer())
      .post('/uploaded-file/initiate')
      .send({ originalName: 'a.txt', contentType: 'text/plain', size: 5 })
      .expect(201)
      .expect(({ body }) => expect(JSON.stringify(body)).not.toContain('secret/object/key'));
    expect(service.initiateUpload).toHaveBeenCalledWith({ originalName: 'a.txt', contentType: 'text/plain', size: 5 });

    await request(app.getHttpServer())
      .post('/uploaded-file/temporary/initiate')
      .send({ originalName: 'temp.txt', contentType: 'text/plain', size: 4 })
      .expect(201);
    expect(service.initiateTemporaryUpload).toHaveBeenCalledWith({ originalName: 'temp.txt', contentType: 'text/plain', size: 4 });

    await request(app.getHttpServer())
      .post('/uploaded-file/initiate')
      .send({ originalName: 'a.txt', contentType: 'text/plain', size: 5, visibility: 'public' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/uploaded-file/temporary/initiate')
      .send({ originalName: 'a.txt', contentType: 'text/plain', size: 5, ttlSeconds: 10 })
      .expect(400);
  });

  it('completes, returns safe detail, and deletes by id without serializing storage keys', async () => {
    for (const [method, path] of [
      ['post', '/uploaded-file/00000000-0000-4000-8000-000000000001/complete'],
      ['get', '/uploaded-file/00000000-0000-4000-8000-000000000001'],
    ] as const) {
      const client = request(app.getHttpServer());
      const operation = method === 'post' ? client.post(path) : client.get(path);
      await operation
        .send({})
        .expect(method === 'post' ? 201 : 200)
        .expect(({ body }) => {
          expect(body.data.url).toBe('https://download.test/signed');
          expect(body.data.key).toBeUndefined();
          expect(body.data.cdn).toBeUndefined();
          expect(JSON.stringify(body)).not.toContain('secret/object/key');
        });
    }

    await request(app.getHttpServer()).delete('/uploaded-file/00000000-0000-4000-8000-000000000001').expect(200, { data: null });
    expect(service.deleteById).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000001');
  });

  it('accepts the local provider upload target as one bounded raw PUT', async () => {
    const bytes = Buffer.from('{"a":1}');
    await request(app.getHttpServer())
      .put('/uploaded-file/00000000-0000-4000-8000-000000000001/content')
      .set('Content-Type', 'application/octet-stream')
      .send(bytes)
      .expect(200);
    expect(service.putUploadContent).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000001',
      expect.objectContaining({ length: bytes.byteLength }),
    );
  });
});
