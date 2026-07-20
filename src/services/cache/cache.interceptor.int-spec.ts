import 'reflect-metadata';
import { Controller, Get, type INestApplication, Param, Query, UseInterceptors } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { CacheModule } from './cache.module';
import { CacheInterceptor } from './cache.interceptor';
import { Cached } from './decorators/cached.decorator';
import type { CacheHttpRequestDescriptor } from './index';

const customResolverInputs: Array<{ descriptor: CacheHttpRequestDescriptor; methodName: string }> = [];

@Controller('cache-descriptor')
@UseInterceptors(CacheInterceptor)
class CacheDescriptorController {
  defaultCalls = 0;
  customCalls = 0;

  @Get('default/:id')
  @Cached({ scope: 'global' })
  defaultKey(@Param('id') id: string, @Query('view') view: string) {
    return { id, view, invocation: ++this.defaultCalls };
  }

  @Get('custom/:id')
  @Cached({
    scope: 'global',
    keyResolver: (descriptor, methodName) => {
      customResolverInputs.push({ descriptor, methodName });
      return { id: descriptor.params.id, view: descriptor.query.view };
    },
  })
  customKey(@Param('id') id: string, @Query('view') view: string) {
    return { id, view, invocation: ++this.customCalls };
  }
}

describe('CacheInterceptor HTTP request descriptor integration', () => {
  let app: INestApplication;
  let controller: CacheDescriptorController;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [CacheModule.forRoot({ ttl: 60 })],
      controllers: [CacheDescriptorController],
    }).compile();
    app = moduleRef.createNestApplication();
    controller = moduleRef.get(CacheDescriptorController);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('does not share default cache entries across different resource or query requests', async () => {
    const server = app.getHttpServer();
    await request(server).get('/cache-descriptor/default/alpha?view=full').expect(200, {
      id: 'alpha',
      view: 'full',
      invocation: 1,
    });
    await request(server).get('/cache-descriptor/default/beta?view=full').expect(200, {
      id: 'beta',
      view: 'full',
      invocation: 2,
    });
    await request(server).get('/cache-descriptor/default/alpha?view=compact').expect(200, {
      id: 'alpha',
      view: 'compact',
      invocation: 3,
    });
    await request(server).get('/cache-descriptor/default/alpha?view=full').expect(200, {
      id: 'alpha',
      view: 'full',
      invocation: 1,
    });
    expect(controller.defaultCalls).toBe(3);
  });

  it('passes only the normalized HTTP descriptor to a custom resolver', async () => {
    customResolverInputs.length = 0;
    const server = app.getHttpServer();
    await request(server).get('/cache-descriptor/custom/alpha?view=full').set('x-not-a-cache-key', 'secret').expect(200, {
      id: 'alpha',
      view: 'full',
      invocation: 1,
    });
    await request(server).get('/cache-descriptor/custom/beta?view=full').expect(200, {
      id: 'beta',
      view: 'full',
      invocation: 2,
    });
    await request(server).get('/cache-descriptor/custom/alpha?view=full').expect(200, {
      id: 'alpha',
      view: 'full',
      invocation: 1,
    });

    expect(controller.customCalls).toBe(2);
    expect(customResolverInputs).toHaveLength(3);
    expect(customResolverInputs[0]).toEqual({
      methodName: 'customKey',
      descriptor: {
        method: 'GET',
        url: '/cache-descriptor/custom/alpha?view=full',
        path: '/cache-descriptor/custom/alpha',
        params: { id: 'alpha' },
        query: { view: 'full' },
        body: undefined,
      },
    });
    expect(customResolverInputs[0].descriptor).not.toHaveProperty('headers');
  });
});
