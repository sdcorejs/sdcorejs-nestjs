import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Inject, Injectable, Optional } from '@nestjs/common';
import { ContextService } from '../core/context/context.service';
import type { ApiErrorBody } from '../core/orm/types/api-response.types';
import type { II18nResolver } from './types';
import { I18N_RESOLVER } from './tokens';

/** A response body is an `apiError` envelope when it carries a string `code`. */
function asApiError(body: unknown): ApiErrorBody | undefined {
  if (body && typeof body === 'object' && typeof (body as ApiErrorBody).code === 'string') {
    return body as ApiErrorBody;
  }
  return undefined;
}

/**
 * Catches `HttpException`s whose body is an `apiError(code, message, data?)` envelope, localizes
 * `message` via the registered `II18nResolver` (using the request's `ctx.lang`), and emits the
 * standard `{ error }` envelope. Non-`apiError` responses pass through untouched.
 *
 * Registered as a global `APP_FILTER` by `I18nModule.forRoot({ useGlobalFilter: true })` (default).
 * With no `II18nResolver` registered, the `code`/`message` pass through unchanged.
 */
@Injectable()
@Catch(HttpException)
export class SdI18nExceptionFilter implements ExceptionFilter {
  constructor(
    @Optional() @Inject(I18N_RESOLVER) private readonly i18n?: II18nResolver,
    @Optional() private readonly ctx?: ContextService,
  ) {}

  catch(exception: HttpException, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const res = http.getResponse<{ status(code: number): { json(body: unknown): unknown } }>();
    const status = exception.getStatus();
    const raw = exception.getResponse();

    const errBody = asApiError(raw);
    if (!errBody) {
      res.status(status).json(raw);
      return;
    }

    const localized: ApiErrorBody = { ...errBody };
    if (this.i18n) {
      const lang = this.ctx?.lang;
      localized.message = this.i18n.translate(errBody.code, lang, errBody.data);
      // Validation envelopes carry per-field i18n codes in `data.issues[].message` (the top-level
      // `code` is the generic `core.validation.failed`). Localize each issue too, merging its
      // `params` for interpolation, so clients get field-level localized messages.
      const data = errBody.data as { issues?: unknown[] } | undefined;
      if (Array.isArray(data?.issues)) {
        localized.data = {
          ...data,
          issues: data.issues.map((iss) => {
            if (iss && typeof iss === 'object' && typeof (iss as { message?: unknown }).message === 'string') {
              const detail = iss as { message: string; params?: Record<string, unknown> };
              return { ...detail, message: this.i18n!.translate(detail.message, lang, detail.params) };
            }
            return iss; // leave non-issue-shaped entries untouched
          }),
        };
      }
    }
    res.status(status).json({ error: localized });
  }
}
