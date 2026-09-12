import type { Request } from 'express';
import { REQUEST_ID_HEADER } from '@samadhaan/shared';

/**
 * Reads the correlation id that `RequestIdMiddleware` attached to the request.
 * Falls back to an empty string so response building never throws on a request
 * that bypassed the middleware (e.g. in a narrow unit test).
 */
export function getRequestId(request: Pick<Request, 'headers'>): string {
  const header = request.headers[REQUEST_ID_HEADER];
  if (Array.isArray(header)) return header[0] ?? '';
  return header ?? '';
}
