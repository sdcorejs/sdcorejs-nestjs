import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { SdCoreModule } from './sd-core.module';
import { ContextService } from './core/context/context.service';
import { CacheService } from './services/cache/cache.service';
import { HttpService } from './services/http/http.service';
import { CONTEXT_HEADERS_CONFIG } from './core/context/tokens';
import { TENANCY_STRATEGY } from './core/tenancy/tokens';
import { AUDIT_STRATEGY } from './core/audit/tokens';
import { PERMISSION_STRATEGY } from './auth/permission/tokens';
import { INTERNAL_SECRET_PROVIDER } from './auth/permission';

describe('SdCoreModule.forRoot', () => {
  it('boots with no options — wires every default strategy', async () => {
    const mod = await Test.createTestingModule({ imports: [SdCoreModule.forRoot()] }).compile();
    expect(mod.get(ContextService)).toBeInstanceOf(ContextService);
    expect(mod.get(CacheService)).toBeInstanceOf(CacheService);
    expect(mod.get(HttpService)).toBeInstanceOf(HttpService);
    expect(mod.get(CONTEXT_HEADERS_CONFIG)).toBeDefined();
    expect(mod.get(TENANCY_STRATEGY)).toBeDefined();
    expect(mod.get(AUDIT_STRATEGY)).toBeDefined();
    expect(mod.get(PERMISSION_STRATEGY)).toBeDefined();
    await mod.close();
  });

  it('boots with per-sub-module config + JWT enabled', async () => {
    const mod = await Test.createTestingModule({
      imports: [
        SdCoreModule.forRoot({
          context: { headers: { tenantCode: 'X-Org-Id' } },
          cache: { ttl: 120 },
          http: { baseURL: 'http://api.internal' },
          jwt: { secret: 'test-secret' },
        }),
      ],
    }).compile();
    const cfg = mod.get<{ tenantCode: string }>(CONTEXT_HEADERS_CONFIG);
    expect(cfg.tenantCode).toBe('X-Org-Id');
    await mod.close();
  });

  it('JWT not wired when option omitted', async () => {
    const mod = await Test.createTestingModule({ imports: [SdCoreModule.forRoot()] }).compile();
    // JwtStrategy is only registered when options.jwt is present — accessing it should throw.
    expect(() => mod.get('JwtStrategy' as never, { strict: false })).toThrow();
    await mod.close();
  });
});

describe('SdCoreModule internalSecret', () => {
  it('binds INTERNAL_SECRET_PROVIDER when internalSecret config is given', () => {
    const mod = SdCoreModule.forRoot({ internalSecret: { envVar: 'X' } });
    const provided = (mod.providers ?? []).map((p: any) => p.provide).filter(Boolean);
    expect(provided).toContain(INTERNAL_SECRET_PROVIDER);
  });
  it('omits it when not configured', () => {
    const mod = SdCoreModule.forRoot({});
    const provided = (mod.providers ?? []).map((p: any) => p.provide).filter(Boolean);
    expect(provided).not.toContain(INTERNAL_SECRET_PROVIDER);
  });
});

describe('SdCoreModule feature composition', () => {
  const names = (mod: any) => (mod.imports ?? []).map((m: any) => (m?.module ?? m)?.name);
  it('omits feature modules when their key is absent', () => {
    const n = names(SdCoreModule.forRoot({}));
    expect(n).not.toContain('UploadedFileModule');
    expect(n).not.toContain('QueueModule');
    expect(n).not.toContain('ActionHistoryModule');
    expect(n).not.toContain('JobSchedulerModule');
  });
  it('wires a feature module when its key is present', () => {
    const n = names(SdCoreModule.forRoot({ actionHistory: { resolveActor: () => ({}) } as any }));
    expect(n).toContain('ActionHistoryModule');
  });
});
