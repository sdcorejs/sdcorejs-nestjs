export interface ApiErrorBody {
  /** i18n key (dot-namespaced) consumer's i18n layer translates to a localized message. */
  code: string;
  /** Default human-readable message in English — fallback when i18n resolver absent. */
  message: string;
  /** Optional template variables for the i18n parser (e.g. `{ id: '...' }`). */
  data?: Record<string, unknown>;
}

export interface ApiResponseEnvelope<T = unknown> {
  data?: T;
  error?: ApiErrorBody;
}

/**
 * Construct an `ApiErrorBody` to throw via `new HttpException(apiError(...), status)`.
 * Consumer's exception filter / i18n middleware reads `code` + `data` and emits the
 * localized message + retains the code for client-side handling.
 */
export const apiError = (code: string, message: string, data?: Record<string, unknown>): ApiErrorBody => ({
  code,
  message,
  data,
});

/**
 * Helpers to construct the standard `{ data, error }` envelope returned by controllers.
 */
export const ApiResponse = {
  ok<T>(data: T): ApiResponseEnvelope<T> {
    return { data };
  },
  noContent(): ApiResponseEnvelope<null> {
    return { data: null };
  },
  error(code: string, message: string, data?: Record<string, unknown>): ApiResponseEnvelope<never> {
    return { error: apiError(code, message, data) };
  },
};
