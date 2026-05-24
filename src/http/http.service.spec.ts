import { HttpService } from './http.service';
import { ContextService } from '../context/context.service';

describe('HttpService', () => {
  it('instantiates with empty config', () => {
    const svc = new HttpService();
    expect(svc).toBeInstanceOf(HttpService);
  });

  it('exposes get/post/put/patch/delete methods', () => {
    const svc = new HttpService();
    expect(typeof svc.get).toBe('function');
    expect(typeof svc.post).toBe('function');
    expect(typeof svc.put).toBe('function');
    expect(typeof svc.patch).toBe('function');
    expect(typeof svc.delete).toBe('function');
  });

  it('accepts ContextService for header propagation', () => {
    const ctx = new ContextService();
    const svc = new HttpService({ baseURL: 'http://localhost' }, ctx);
    expect(svc).toBeInstanceOf(HttpService);
  });
});
