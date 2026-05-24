import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { SdCoreModule } from './sd-core.module';
import { ContextService } from './context/context.service';
import { CacheService } from './cache/cache.service';
import { HttpService } from './http/http.service';
import { CONTEXT_HEADERS_CONFIG } from './context/tokens';
import { TENANCY_STRATEGY } from './tenancy/tokens';
import { AUDIT_STRATEGY } from './audit/tokens';
import { PERMISSION_STRATEGY } from './permission/tokens';

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
