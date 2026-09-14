import { HttpException, HttpStatus } from '@nestjs/common';
import { ERROR_CODES, type ApiErrorDetail, type ErrorCode } from '@samadhaan/shared';

/**
 * Domain exception carrying a stable machine-readable code alongside the HTTP
 * status. Feature modules throw these so clients can branch on `error.code`
 * instead of parsing messages.
 */
export class AppException extends HttpException {
  constructor(
    readonly code: ErrorCode,
    message: string,
    status: HttpStatus,
    readonly details?: ApiErrorDetail[],
  ) {
    super(message, status);
  }

  static notFound(resource: string, details?: ApiErrorDetail[]): AppException {
    return new AppException(
      ERROR_CODES.NOT_FOUND,
      `${resource} not found`,
      HttpStatus.NOT_FOUND,
      details,
    );
  }

  static conflict(message: string, details?: ApiErrorDetail[]): AppException {
    return new AppException(ERROR_CODES.CONFLICT, message, HttpStatus.CONFLICT, details);
  }

  /** A malformed request the DTO layer could not express — a bad cursor, say. */
  static badRequest(message: string, details?: ApiErrorDetail[]): AppException {
    return new AppException(
      ERROR_CODES.VALIDATION_FAILED,
      message,
      HttpStatus.BAD_REQUEST,
      details,
    );
  }

  static forbidden(message = 'You do not have access to this resource'): AppException {
    return new AppException(ERROR_CODES.FORBIDDEN, message, HttpStatus.FORBIDDEN);
  }

  static unauthorized(message = 'Authentication required'): AppException {
    return new AppException(ERROR_CODES.UNAUTHORIZED, message, HttpStatus.UNAUTHORIZED);
  }

  /** An upstream the API depends on (AI service, storage, provider) is unusable. */
  static upstreamUnavailable(upstream: string, message?: string): AppException {
    return new AppException(
      ERROR_CODES.UPSTREAM_UNAVAILABLE,
      message ?? `${upstream} is currently unavailable`,
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}
