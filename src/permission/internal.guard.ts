import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Optional,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { apiError } from '../orm/types/api-response.types';
import {
  type IInternalSecretProvider,
  INTERNAL_SECRET_PROVIDER,
} from './internal-secret.provider';
import {
  type IInternalContextEnricher,
  INTERNAL_CONTEXT_ENRICHER,
} from './internal-context.enricher';

/** Default header name the guard reads. Override per-instance via subclass if needed. */
export const INTERNAL_SECRET_HEADER = 'x-internal-secret';

/**
 * Gate for internal-only endpoints. Compares `X-Internal-Secret` header against
 * `IInternalSecretProvider.getKey()` using constant-time comparison.
 *
 * Consumer must register a provider:
 *
 *   SdCoreModule.forRoot({
 *     providers: [{ provide: INTERNAL_SECRET_PROVIDER, useClass: MyProvider }],
 *   });
 *
 * Apply per-route via `@UseGuards(InternalGuard)`. When no provider is registered,
 * the guard throws 500 at request time (not at boot) — keeps the module DI graph
 * bootable without forcing every consumer to wire internal-call auth.
 */
@Injectable()
export class InternalGuard implements CanActivate {
  constructor(
    @Optional() @Inject(INTERNAL_SECRET_PROVIDER) private readonly provider?: IInternalSecretProvider,
    @Optional() @Inject(INTERNAL_CONTEXT_ENRICHER) private readonly enricher?: IInternalContextEnricher,
  ) {}

  async canActivate(execCtx: ExecutionContext): Promise<boolean> {
    if (!this.provider) {
      throw new InternalServerErrorException(
        apiError(
          'core.permission.internal-secret-provider-missing',
          'InternalGuard requires INTERNAL_SECRET_PROVIDER to be registered via SdCoreModule.forRoot({ providers })',
        ),
      );
    }
    const req = execCtx.switchToHttp().getRequest<IncomingMessage>();
    const raw = req.headers[INTERNAL_SECRET_HEADER];
    const provided = Array.isArray(raw) ? raw[0] : raw;
    if (!provided) {
      throw new ForbiddenException(
        apiError('core.permission.internal-secret-missing', `Missing ${INTERNAL_SECRET_HEADER} header`),
      );
    }
    const expected = this.provider.getKeys
      ? await this.provider.getKeys()
      : [await this.provider.getKey()];
    if (!expected.some((key) => this.safeEqual(provided, key))) {
      throw new ForbiddenException(apiError('core.permission.internal-secret-mismatch', 'Invalid internal secret'));
    }
    if (this.enricher) await this.enricher.enrich(req);
    return true;
  }

  private safeEqual(a: string, b: string): boolean {
    const ab = Buffer.from(a, 'utf8');
    const bb = Buffer.from(b, 'utf8');
    if (ab.length !== bb.length) return false;
    return timingSafeEqual(ab, bb);
  }
}
