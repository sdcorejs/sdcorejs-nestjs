import type { IncomingMessage } from 'node:http';

/**
 * DI hook that lets internal callers carry trusted context. Backend implements + registers via
 * `SdCoreModule.forRoot({ providers: [{ provide: INTERNAL_CONTEXT_ENRICHER, useClass: ... }] })`.
 *
 * `InternalGuard` calls `enrich(req)` ONLY after the `X-Internal-Secret` check passes — so any
 * context derived from inbound headers (caller identity, tenant, acting user) is trusted only on
 * verified internal calls, never on public traffic. The implementation typically injects
 * `ContextService` and writes the resolved values into the request store.
 *
 * @example
 * @Injectable()
 * export class MyInternalEnricher implements IInternalContextEnricher {
 *   constructor(private readonly ctx: ContextService) {}
 *   enrich(req: IncomingMessage) {
 *     const h = req.headers;
 *     this.ctx.set('tenant', h['x-tenant'] as string);
 *     this.ctx.set('userId', h['x-user-id'] as string);
 *     this.ctx.set('custom', { isInternalCall: true, caller: h['x-caller'] });
 *   }
 * }
 */
export interface IInternalContextEnricher {
  enrich(req: IncomingMessage): void | Promise<void>;
}

export const INTERNAL_CONTEXT_ENRICHER = Symbol('INTERNAL_CONTEXT_ENRICHER');
