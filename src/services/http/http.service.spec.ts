jest.mock('axios', () => {
  const instance = {
    interceptors: { request: { use: jest.fn() } },
    get: jest.fn(async () => ({ data: 'GET' })),
    post: jest.fn(async () => ({ data: 'POST' })),
    put: jest.fn(async () => ({ data: 'PUT' })),
    patch: jest.fn(async () => ({ data: 'PATCH' })),
    delete: jest.fn(async () => ({ data: 'DELETE' })),
  };
  return { __esModule: true, default: { create: jest.fn(() => instance) } };
});

import axios from 'axios';
import { HttpService } from './http.service';
import type { ContextService } from '../../core/context/context.service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const createMock = (axios as any).create as jest.Mock;
const latestInstance = () => createMock.mock.results.at(-1)!.value;
const interceptorFn = () => latestInstance().interceptors.request.use.mock.calls.at(-1)![0];
const fakeCtx = (store: unknown): ContextService => ({ store }) as unknown as ContextService;

describe('HttpService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('configures axios with baseURL and default timeout', () => {
    new HttpService({ baseURL: 'http://api' });
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ baseURL: 'http://api', timeout: 30_000 }));
  });

  it('verb helpers return response.data', async () => {
    const svc = new HttpService({ baseURL: 'http://api' });
    expect(await svc.get('/x')).toBe('GET');
    expect(await svc.post('/x', {})).toBe('POST');
    expect(await svc.put('/x', {})).toBe('PUT');
    expect(await svc.patch('/x', {})).toBe('PATCH');
    expect(await svc.delete('/x')).toBe('DELETE');
  });

  it('propagates tenant + userId context headers on outbound requests', () => {
    new HttpService({ baseURL: 'http://api' }, fakeCtx({ tenant: 't1', userId: 'u1' }));
    const cfg = interceptorFn()({ headers: {} });
    expect(cfg.headers['x-tenant']).toBe('t1');
    expect(cfg.headers['x-user-id']).toBe('u1');
  });

  it('propagates consumer custom headers from ctx.custom', () => {
    new HttpService({ baseURL: 'http://api' }, fakeCtx({ custom: { role: 'admin' } }), {
      tenant: 'x-tenant',
      userId: 'x-user-id',
      customHeaders: { role: 'x-role' },
    } as never);
    const cfg = interceptorFn()({ headers: {} });
    expect(cfg.headers['x-role']).toBe('admin');
  });

  it('leaves the request untouched when there is no active context', () => {
    new HttpService({ baseURL: 'http://api' }); // no ContextService
    const cfg = interceptorFn()({ headers: {} });
    expect(cfg.headers).toEqual({});
  });
});
