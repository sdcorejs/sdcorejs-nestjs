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
});
