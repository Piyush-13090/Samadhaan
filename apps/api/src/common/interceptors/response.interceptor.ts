import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { map, type Observable } from 'rxjs';
import type { ApiSuccessResponse } from '@samadhaan/shared';
import { buildSuccessResponse } from '../api-response.js';
import { getRequestId } from '../request-context.js';

/**
 * Wraps every successful controller return value in the standard envelope.
 * Controllers stay free to return plain objects; the transport shape is applied
 * in exactly one place, which keeps it consistent as modules are added.
 */
@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, ApiSuccessResponse<T>> {
  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiSuccessResponse<T>> {
    const request = context.switchToHttp().getRequest<Request>();

    return next
      .handle()
      .pipe(map((data) => buildSuccessResponse(data, getRequestId(request))));
  }
}
