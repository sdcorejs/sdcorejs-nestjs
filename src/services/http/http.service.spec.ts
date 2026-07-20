jest.mock('axios', () => {
  const actual = jest.requireActual<typeof import('axios')>('axios');
  const instance = {
    interceptors: { request: { use: jest.fn() } },
    get: jest.fn(async () => ({ data: 'GET' })),
    post: jest.fn(async () => ({ data: 'POST' })),
    put: jest.fn(async () => ({ data: 'PUT' })),
    patch: jest.fn(async () => ({ data: 'PATCH' })),
    delete: jest.fn(async () => ({ data: 'DELETE' })),
  };
  return { __esModule: true, ...actual, default: { ...actual.default, create: jest.fn(() => instance) } };
});

import axios, { type AxiosHeaders, type AxiosRequestConfig } from 'axios';
import type { ContextService } from '../../core/context/context.service';
import { HttpService } from './http.service';

const createMock = axios.create as jest.Mock;
const latestInstance = () => createMock.mock.results.at(-1)!.value;
const interceptorFn = () => latestInstance().interceptors.request.use.mock.calls.at(-1)![0];
const intercept = (config: AxiosRequestConfig = {}) => {
  const defaults = createMock.mock.calls.at(-1)![0] as AxiosRequestConfig;
  return interceptorFn()({ ...defaults, ...config });
};
const fakeContext = (store: unknown): ContextService => ({ store }) as unknown as ContextService;

describe('HttpService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('configures axios with baseURL and default timeout', () => {
    new HttpService({ baseURL: 'https://api.internal' });
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ baseURL: 'https://api.internal', timeout: 30_000 }));
  });

  it('returns response.data from verb helpers', async () => {
    const service = new HttpService({ baseURL: 'https://api.internal' });
    await expect(service.get('/x')).resolves.toBe('GET');
    await expect(service.post('/x', {})).resolves.toBe('POST');
    await expect(service.put('/x', {})).resolves.toBe('PUT');
    await expect(service.patch('/x', {})).resolves.toBe('PATCH');
    await expect(service.delete('/x')).resolves.toBe('DELETE');
  });

  it('does not propagate identity headers when no trusted origin is configured', () => {
    new HttpService({ baseURL: 'https://api.internal' }, fakeContext({ tenant: 't1', userId: 'u1' }));
    const config = intercept({ url: '/orders', headers: { 'x-tenant': 'caller-value', 'x-safe': 'keep' } });
    const headers = config.headers as AxiosHeaders;
    expect(headers.get('x-tenant')).toBeUndefined();
    expect(headers.get('x-user-id')).toBeUndefined();
    expect(headers.get('x-safe')).toBe('keep');
  });

  it('propagates canonical and custom context headers to an exact trusted origin', () => {
    new HttpService(
      { baseURL: 'https://api.internal/v1', trustedOrigins: ['https://api.internal/ignored-path'] },
      fakeContext({ tenant: 't1', userId: 'u1', custom: { department: 'D1' } }),
      {
        tenant: 'x-tenant',
        userId: 'x-user-id',
        customHeaders: { department: 'x-department' },
      },
    );
    const headers = intercept({ url: '/orders', headers: { 'x-internal-secret': 'caller-secret' } }).headers as AxiosHeaders;
    expect(headers.get('x-tenant')).toBe('t1');
    expect(headers.get('x-user-id')).toBe('u1');
    expect(headers.get('x-department')).toBe('D1');
    expect(headers.get('x-internal-secret')).toBe('caller-secret');
  });

  it('strips caller-supplied identity headers at a trusted origin when context is empty', () => {
    new HttpService({ baseURL: 'https://api.internal', trustedOrigins: ['https://api.internal'] }, fakeContext({}), {
      tenant: 'x-tenant',
      userId: 'x-user-id',
      customHeaders: { department: 'x-department' },
    });
    const headers = intercept({
      url: '/orders',
      headers: {
        'X-Tenant': 'forged-tenant',
        'x-user-id': 'forged-user',
        'X-Department': 'forged-department',
        'x-internal-secret': 'caller-secret',
        'x-safe': 'keep',
      },
    }).headers as AxiosHeaders;

    expect(headers.get('x-tenant')).toBeUndefined();
    expect(headers.get('x-user-id')).toBeUndefined();
    expect(headers.get('x-department')).toBeUndefined();
    expect(headers.get('x-internal-secret')).toBe('caller-secret');
    expect(headers.get('x-safe')).toBe('keep');
  });

  it('replaces only context-backed identity headers at a trusted origin when context is partial', () => {
    new HttpService(
      { baseURL: 'https://api.internal', trustedOrigins: ['https://api.internal'] },
      fakeContext({ tenant: 'verified-tenant' }),
      {
        tenant: 'x-tenant',
        userId: 'x-user-id',
        customHeaders: { department: 'x-department' },
      },
    );
    const headers = intercept({
      url: '/orders',
      headers: {
        'x-tenant': 'forged-tenant',
        'x-user-id': 'forged-user',
        'x-department': 'forged-department',
      },
    }).headers as AxiosHeaders;

    expect(headers.get('x-tenant')).toBe('verified-tenant');
    expect(headers.get('x-user-id')).toBeUndefined();
    expect(headers.get('x-department')).toBeUndefined();
  });

  it('keeps Authorization caller-owned even when propagation config attempts to name it', () => {
    new HttpService(
      {
        baseURL: 'https://api.internal',
        trustedOrigins: ['https://api.internal'],
        propagateHeaders: ['authorization'],
      },
      fakeContext({ token: 'Bearer context-token', custom: { apiAuthorization: 'Bearer context-custom-token' } }),
      {
        tenant: 'x-tenant',
        userId: 'x-user-id',
        customHeaders: { apiAuthorization: 'authorization' },
      },
    );
    const headers = intercept({
      url: '/orders',
      headers: { authorization: 'Bearer caller-token' },
    }).headers as AxiosHeaders;

    expect(headers.get('authorization')).toBe('Bearer caller-token');
  });

  it.each(['https://evil.example/orders', 'https://api.internal.evil.example/orders', 'http://api.internal/orders'])(
    'strips identity headers from an untrusted absolute URL: %s',
    (url) => {
      new HttpService(
        { baseURL: 'https://api.internal', trustedOrigins: ['https://api.internal'] },
        fakeContext({ tenant: 't1', userId: 'u1' }),
      );
      const headers = intercept({
        url,
        headers: {
          'X-Tenant': 'manual-tenant',
          'x-user-id': 'manual-user',
          'x-internal-secret': 'internal-secret',
          authorization: 'Bearer service-token',
        },
      }).headers as AxiosHeaders;
      expect(headers.get('x-tenant')).toBeUndefined();
      expect(headers.get('x-user-id')).toBeUndefined();
      expect(headers.get('x-internal-secret')).toBeUndefined();
      expect(headers.get('authorization')).toBe('Bearer service-token');
    },
  );

  it('keeps the exact origin boundary including non-default ports', () => {
    new HttpService({ baseURL: 'https://api.internal:8443', trustedOrigins: ['https://api.internal:8443'] }, fakeContext({ tenant: 't1' }));
    expect((intercept({ url: '/x' }).headers as AxiosHeaders).get('x-tenant')).toBe('t1');
    expect(
      (intercept({ url: 'https://api.internal/x', headers: { 'x-tenant': 'manual' } }).headers as AxiosHeaders).get('x-tenant'),
    ).toBeUndefined();
  });

  it('strips identity headers when a trusted request redirects to an untrusted origin', () => {
    const consumerHook = jest.fn((options: { headers?: Record<string, unknown> }) => {
      if (options.headers) options.headers['x-user-id'] = 'consumer-added';
    });
    new HttpService(
      { baseURL: 'https://api.internal', trustedOrigins: ['https://api.internal'] },
      fakeContext({ tenant: 't1', userId: 'u1' }),
    );
    const config = intercept({ url: '/redirect', beforeRedirect: consumerHook });
    const options = {
      protocol: 'https:',
      hostname: 'evil.example',
      headers: {
        'x-tenant': 't1',
        'X-User-Id': 'u1',
        'x-internal-secret': 'internal-secret',
        authorization: 'Bearer service-token',
        'x-safe': 'keep',
      },
    };
    config.beforeRedirect(options, {} as never, {} as never);
    expect(consumerHook).toHaveBeenCalledTimes(1);
    expect(options.headers).toEqual({ authorization: 'Bearer service-token', 'x-safe': 'keep' });
  });

  it('preserves identity headers across redirects within the same trusted origin', () => {
    new HttpService({ baseURL: 'https://api.internal', trustedOrigins: ['https://api.internal'] }, fakeContext({ tenant: 't1' }));
    const config = intercept({ url: '/redirect' });
    const options = {
      protocol: 'https:',
      hostname: 'api.internal',
      headers: { 'x-tenant': 'forged-tenant', 'x-internal-secret': 'internal-secret' },
    };
    config.beforeRedirect(options, {} as never, {} as never);
    expect(options.headers).toEqual({ 'x-internal-secret': 'internal-secret', 'x-tenant': 't1' });
  });

  it('rejects non-HTTP trusted origins during construction', () => {
    expect(() => new HttpService({ trustedOrigins: ['ftp://api.internal'] })).toThrow('supports only HTTP(S) origins');
  });
});
