import {
  API_VERSION,
  type ApiErrorBody,
  type ApiErrorDetail,
  type ApiErrorResponse,
  type ApiMeta,
  type ApiSuccessResponse,
  type ErrorCode,
} from '@samadhaan/shared';

/**
 * Single definition of the response envelope.
 *
 * The success interceptor, the exception filter and the unmatched-route
 * fallback all build responses here, so there is exactly one place that decides
 * what an API response looks like.
 */

function buildMeta(requestId: string): ApiMeta {
  return {
    timestamp: new Date().toISOString(),
    requestId,
    version: API_VERSION,
  };
}

export function buildSuccessResponse<TData>(
  data: TData,
  requestId: string,
): ApiSuccessResponse<TData> {
  return { success: true, data, meta: buildMeta(requestId) };
}

export function buildErrorResponse(
  code: ErrorCode,
  message: string,
  requestId: string,
  details?: ApiErrorDetail[],
): ApiErrorResponse {
  const error: ApiErrorBody = { code, message };
  if (details?.length) error.details = details;

  return { success: false, error, meta: buildMeta(requestId) };
}
