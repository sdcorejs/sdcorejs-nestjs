import type { IncomingMessage } from 'node:http';

/**
 * DI hook that lets internal callers carry trusted context. Backend implements + registers via
 * `SdCoreModule.forRoot({ providers: [{ provide: INTERNAL_CONTEXT_ENRICHER, useClass: ... }] })`.
 *
 * `InternalGuard` calls `enrich(req)` ONLY after the `X-Internal-Secret` check passes. That
 * authenticates the internal caller, but implementations must still validate and authorize every
 * identity header before writing it to the request store.
 *
 * @example
 * function requiredIdentity(value: string | string[] | undefined, name: string): string {
 *   if (typeof value !== 'string') throw new UnauthorizedException(`Missing or repeated ${name}`);
 *   const normalized = value.trim();
 *   if (!normalized || normalized.length > 64 || !/^[A-Za-z0-9._:-]+$/.test(normalized)) {
 *     throw new UnauthorizedException(`Invalid ${name}`);
 *   }
 *   return normalized;
 * }
 *
 * @Injectable()
 * export class MyInternalEnricher implements IInternalContextEnricher {
 *   constructor(private readonly ctx: ContextService) {}
 *   enrich(req: IncomingMessage) {
 *     const h = req.headers;
 *     this.ctx.set('tenant', requiredIdentity(h['x-tenant'], 'X-Tenant'));
 *     this.ctx.set('userId', requiredIdentity(h['x-user-id'], 'X-User-Id'));
 *     this.ctx.set('custom', {
 *       isInternalCall: true,
 *       caller: requiredIdentity(h['x-caller'], 'X-Caller'),
 *     });
 *   }
 * }
 */
export interface IInternalContextEnricher {
  enrich(req: IncomingMessage): void | Promise<void>;
}

export const INTERNAL_CONTEXT_ENRICHER = Symbol('INTERNAL_CONTEXT_ENRICHER');
