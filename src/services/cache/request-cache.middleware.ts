import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Per-request cache scope — attaches a fresh `Map` to `req.requestCache`. Useful for
 * memoizing repeated expensive lookups within a single HTTP request without persisting
 * across requests.
 */
@Injectable()
export class RequestCacheMiddleware implements NestMiddleware {
  use(req: IncomingMessage & { requestCache?: Map<string, unknown> }, _res: ServerResponse, next: () => void): void {
    req.requestCache = new Map();
    next();
  }
}
