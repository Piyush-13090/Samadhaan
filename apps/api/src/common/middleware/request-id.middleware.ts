import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { resolveRequestId } from '../request-context.js';

/**
 * Ensures every request carries a correlation id. A short, plain inbound id is
 * reused so a trace can span web -> api -> ai; anything else is replaced. The
 * logger resolves it first, so this reuses that same id.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    resolveRequestId(req, res);
    next();
  }
}
