import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
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

const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * The request's correlation id, decided once (Prompt 26).
 *
 * An inbound `x-request-id` is reused only if it is short and plain — anything
 * else could forge or confuse log lines — and the chosen id is written back
 * onto the request, so the logger, the error envelope, the response header and
 * calls to the AI service all carry the same value.
 */
export function resolveRequestId(req: IncomingMessage, res?: ServerResponse): string {
  const incoming = req.headers[REQUEST_ID_HEADER];
  const value = (Array.isArray(incoming) ? incoming[0] : incoming)?.trim() ?? '';
  const id = SAFE_REQUEST_ID.test(value) ? value : randomUUID();
  req.headers[REQUEST_ID_HEADER] = id;
  if (res && !res.headersSent) res.setHeader(REQUEST_ID_HEADER, id);
  return id;
}
