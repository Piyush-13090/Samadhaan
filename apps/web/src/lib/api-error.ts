import type { ApiErrorBody, ErrorCode } from '@samadhaan/shared';

/**
 * A failed API call, carrying the structured error the backend returned.
 *
 * UI code branches on `code` — a stable contract — rather than on the message
 * text or the HTTP status.
 */
export class ApiError extends Error {
  readonly code: ErrorCode | 'NETWORK_ERROR';
  readonly status: number;
  readonly details?: ApiErrorBody['details'];
  readonly requestId?: string;

  constructor(params: {
    code: ErrorCode | 'NETWORK_ERROR';
    message: string;
    status: number;
    details?: ApiErrorBody['details'];
    requestId?: string;
  }) {
    super(params.message);
    this.name = 'ApiError';
    this.code = params.code;
    this.status = params.status;
    this.details = params.details;
    this.requestId = params.requestId;
  }

  /** The API was unreachable — distinct from the API returning an error. */
  static network(message: string): ApiError {
    return new ApiError({ code: 'NETWORK_ERROR', message, status: 0 });
  }

  /** True when retrying could plausibly succeed. */
  get isRetryable(): boolean {
    return this.code === 'NETWORK_ERROR' || this.status >= 500 || this.status === 429;
  }
}
