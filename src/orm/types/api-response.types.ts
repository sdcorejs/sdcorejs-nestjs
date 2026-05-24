export interface ApiResponseError {
  vi: string;
  en: string;
  code?: string;
}

export interface ApiResponseEnvelope<T = unknown> {
  data?: T;
  error?: ApiResponseError;
}

/**
 * Helpers to construct the standard `{ data, error }` envelope returned by controllers.
 * Error messages MUST be bilingual `{ vi, en }`.
 */
export const ApiResponse = {
  ok<T>(data: T): ApiResponseEnvelope<T> {
    return { data };
  },
  noContent(): ApiResponseEnvelope<null> {
    return { data: null };
  },
  error(vi: string, en: string, code?: string): ApiResponseEnvelope<never> {
    return { error: { vi, en, code } };
  },
};
