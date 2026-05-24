import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ContextService } from './context.service';
import type { HeadersConfig, RequestContext } from './context.types';
import { CONTEXT_HEADERS_CONFIG } from './tokens';

@Injectable()
export class ContextMiddleware implements NestMiddleware {
  constructor(
    private readonly context: ContextService,
    @Inject(CONTEXT_HEADERS_CONFIG) private readonly headers: HeadersConfig,
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

    const custom: Record<string, unknown> = {};
    for (const [ctxKey, headerName] of Object.entries(this.headers.customHeaders ?? {})) {
      const value = read(headerName);
      if (value !== undefined) custom[ctxKey] = value;
    }

    return {
      tenantCode: read(this.headers.tenantCode),
      userId: read(this.headers.userId),
      lang: this.detectLang(req),
      token: this.extractToken(req),
      request: req,
      response: res,
      custom: Object.keys(custom).length > 0 ? custom : undefined,
    };
  }

  private detectLang(req: IncomingMessage): 'vi' | 'en' {
    const priority = this.headers.lang ?? ['accept-language', 'x-language'];
    for (const name of priority) {
      const raw = req.headers[name.toLowerCase()];
      const value = Array.isArray(raw) ? raw[0] : raw;
      if (value) {
        return value.toLowerCase().startsWith('en') ? 'en' : 'vi';
      }
    }
    return 'vi';
  }

  private extractToken(req: IncomingMessage): string | undefined {
    const auth = req.headers['authorization'];
    return typeof auth === 'string' ? auth : undefined;
  }
}
