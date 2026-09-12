/**
 * The wire format every Samadhaan API endpoint speaks.
 * The NestJS `ResponseInterceptor` produces it; the web API client consumes it.
 */

export interface ApiMeta {
  /** ISO-8601 timestamp of when the response was produced. */
  timestamp: string;
  /** Correlation id, also returned in the `x-request-id` header. */
  requestId: string;
  /** API version that served the request, e.g. `v1`. */
  version: string;
}

export interface ApiSuccessResponse<TData> {
  success: true;
  data: TData;
  meta: ApiMeta;
}

export interface ApiErrorDetail {
  /** Dot-path of the offending field, when the error is field-scoped. */
  field?: string;
  message: string;
}

export interface ApiErrorBody {
  /** Stable machine-readable code, e.g. `VALIDATION_FAILED`. */
  code: string;
  /** Human-readable summary, safe to surface in a UI. */
  message: string;
  /** Field-level breakdown, present for validation failures. */
  details?: ApiErrorDetail[];
}

export interface ApiErrorResponse {
  success: false;
  error: ApiErrorBody;
  meta: ApiMeta;
}

export type ApiResponse<TData> = ApiSuccessResponse<TData> | ApiErrorResponse;

export function isApiSuccess<TData>(
  response: ApiResponse<TData>,
): response is ApiSuccessResponse<TData> {
  return response.success;
}

/** Envelope for list endpoints. Cursor pagination keeps large feeds stable. */
export interface PaginatedData<TItem> {
  items: TItem[];
  /** Opaque cursor to pass as `cursor` for the next page; `null` when exhausted. */
  nextCursor: string | null;
  /** Total matching rows, when the endpoint can compute it cheaply. */
  totalCount?: number;
}
