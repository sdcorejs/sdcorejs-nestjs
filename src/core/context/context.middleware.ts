import { Inject, Injectable, UnauthorizedException, type NestMiddleware } from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ContextService } from './context.service';
import { normalizeContextIdentity } from './identity.resolver';
import type { HeadersConfig, RequestContext, ResolvedContextIdentityOptions } from './types';
import { CONTEXT_HEADERS_CONFIG, CONTEXT_IDENTITY_CONFIG } from './tokens';

@Injectable()
export class ContextMiddleware implements NestMiddleware {
  constructor(
    private readonly context: ContextService,
    @Inject(CONTEXT_HEADERS_CONFIG) private readonly headers: HeadersConfig,
    @Inject(CONTEXT_IDENTITY_CONFIG) private readonly identity: ResolvedContextIdentityOptions,
  ) {}

  use(req: IncomingMessage, res: ServerResponse, next: () => void): void {
    const store = this.buildStore(req, res);
    this.context.run(store, () => next());
  }

  private buildStore(req: IncomingMessage, res: ServerResponse): RequestContext {
    const read = (name?: string): string | undefined => {
      if (!name) return undefined;
      const raw = req.headers[name.toLowerCase()];
      if (raw === undefined) return undefined;
      return Array.isArray(raw) ? raw[0] : raw;
    };

    const store: RequestContext = {
      lang: this.detectLang(req),
      token: this.extractToken(req),
      request: req,
      response: res,
    };

    const trustedHeaders = this.identity.trustedHeaders;
    if (!trustedHeaders || !this.hasIdentityHeaders(req)) return store;
    if (trustedHeaders.isTrustedRequest(req) !== true) {
      throw new UnauthorizedException('Identity headers are accepted only from a verified trusted gateway');
    }

    const resolved = normalizeContextIdentity(
      trustedHeaders.resolve?.(req) ?? {
        tenant: read(this.headers.tenant),
        userId: read(this.headers.userId),
        custom: this.readCustomHeaders(req),
      },
    );
    Object.assign(store, resolved, { identitySource: 'trusted-headers' as const });
    return store;
  }

  private hasIdentityHeaders(req: IncomingMessage): boolean {
    const names = [this.headers.tenant, this.headers.userId, ...Object.values(this.headers.customHeaders ?? {})].filter(
      (name): name is string => !!name,
    );
    return names.some((name) => req.headers[name.toLowerCase()] !== undefined);
  }

  private readCustomHeaders(req: IncomingMessage): Record<string, unknown> | undefined {
    const custom: Record<string, unknown> = {};
    for (const [ctxKey, headerName] of Object.entries(this.headers.customHeaders ?? {})) {
      const raw = req.headers[headerName.toLowerCase()];
      const value = Array.isArray(raw) ? raw[0] : raw;
      if (value !== undefined) custom[ctxKey] = value;
    }
    return Object.keys(custom).length > 0 ? custom : undefined;
  }

  private detectLang(req: IncomingMessage): string | undefined {
    const priority = this.headers.lang ?? ['accept-language', 'x-language'];
    for (const name of priority) {
      const raw = req.headers[name.toLowerCase()];
      const value = Array.isArray(raw) ? raw[0] : raw;
      if (value) return value;
    }
    return undefined;
  }

  private extractToken(req: IncomingMessage): string | undefined {
    const auth = req.headers['authorization'];
    return typeof auth === 'string' ? auth : undefined;
  }
}
