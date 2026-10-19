import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ERROR_CODES, type ApiErrorDetail, type ErrorCode } from '@samadhaan/shared';
import { buildErrorResponse } from '../api-response.js';
import { AppException } from '../app.exception.js';
import { getRequestId } from '../request-context.js';

/** Shape produced by Nest's `ValidationPipe` when `class-validator` rejects a DTO. */
interface ValidationExceptionBody {
  message: string[];
  error?: string;
}

function isValidationBody(body: unknown): body is ValidationExceptionBody {
  return (
    typeof body === 'object' &&
    body !== null &&
    Array.isArray((body as ValidationExceptionBody).message)
  );
}

/** Maps HTTP statuses that are not raised as `AppException` onto stable codes. */
const STATUS_TO_CODE: Partial<Record<number, ErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: ERROR_CODES.VALIDATION_FAILED,
  [HttpStatus.UNAUTHORIZED]: ERROR_CODES.UNAUTHORIZED,
  [HttpStatus.FORBIDDEN]: ERROR_CODES.FORBIDDEN,
  [HttpStatus.NOT_FOUND]: ERROR_CODES.NOT_FOUND,
  [HttpStatus.CONFLICT]: ERROR_CODES.CONFLICT,
  [HttpStatus.TOO_MANY_REQUESTS]: ERROR_CODES.RATE_LIMITED,
  [HttpStatus.PAYLOAD_TOO_LARGE]: ERROR_CODES.PAYLOAD_TOO_LARGE,
  [HttpStatus.SERVICE_UNAVAILABLE]: ERROR_CODES.UPSTREAM_UNAVAILABLE,
};

/**
 * Terminal error handler. Guarantees that every failure — thrown by a
 * controller, a pipe, or an unhandled library — leaves the process as a single
 * documented error envelope, and that internal details never leak to clients.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const { status, code, message, details } = this.describe(exception);

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${request.method} ${request.path} -> ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.warn(`${request.method} ${request.path} -> ${status} ${code}`);
    }

    response
      .status(status)
      .json(buildErrorResponse(code, message, getRequestId(request), details));
  }

  private describe(exception: unknown): {
    status: number;
    code: ErrorCode;
    message: string;
    details?: ApiErrorDetail[];
  } {
    if (exception instanceof AppException) {
      return {
        status: exception.getStatus(),
        code: exception.code,
        message: exception.message,
        details: exception.details,
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const code = STATUS_TO_CODE[status] ?? ERROR_CODES.INTERNAL_ERROR;

      if (isValidationBody(body)) {
        return {
          status,
          code: ERROR_CODES.VALIDATION_FAILED,
          message: 'Request validation failed',
          details: body.message.map((entry) => ({ message: entry })),
        };
      }

      return { status, code, message: exception.message };
    }

    // Body-parser and multer failures are client errors, not 500s (Prompt
    // 26): an oversized or malformed body must not look like a server fault.
    const parserError = exception as {
      type?: unknown;
      status?: unknown;
      expose?: unknown;
    };
    if (parserError?.type === 'entity.too.large' || parserError?.status === 413) {
      return {
        status: HttpStatus.PAYLOAD_TOO_LARGE,
        code: ERROR_CODES.PAYLOAD_TOO_LARGE,
        message: 'The request is too large.',
      };
    }
    if (
      parserError?.expose === true &&
      typeof parserError.status === 'number' &&
      parserError.status >= 400 &&
      parserError.status < 500
    ) {
      return {
        status: parserError.status,
        code: STATUS_TO_CODE[parserError.status] ?? ERROR_CODES.VALIDATION_FAILED,
        message: 'The request could not be read.',
      };
    }

    // An uncaught unique-constraint violation (Prisma P2002) is a conflicting
    // or repeated request — a double-clicked submit, two people acting at
    // once — not a server fault (Prompt 29). Constraint names are not echoed.
    const prismaError = exception as { name?: unknown; code?: unknown };
    if (
      prismaError?.name === 'PrismaClientKnownRequestError' &&
      prismaError.code === 'P2002'
    ) {
      return {
        status: HttpStatus.CONFLICT,
        code: ERROR_CODES.CONFLICT,
        message:
          'This conflicts with a change that was already made. Refresh and try again.',
      };
    }

    // Unknown failure: log the detail, return an opaque message.
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ERROR_CODES.INTERNAL_ERROR,
      message: 'An unexpected error occurred',
    };
  }
}
