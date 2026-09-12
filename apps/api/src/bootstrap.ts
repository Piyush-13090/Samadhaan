import { VersioningType, type INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import { API_GLOBAL_PREFIX, API_VERSION, ERROR_CODES } from '@samadhaan/shared';
import { buildErrorResponse } from './common/api-response.js';
import { getRequestId } from './common/request-context.js';
import { createValidationPipe } from './common/validation.pipe.js';

/**
 * Applies every framework-level concern to a Nest application.
 *
 * `main.ts` and the e2e suite both call this, so the application under test is
 * configured exactly like the one that runs in production — a route prefix or
 * pipe that exists only in one of them is a class of bug this removes.
 */
export function configureApp(app: INestApplication): void {
  // Authentication cookies arrive as a raw header; parse them before any guard
  // tries to read one.
  app.use(cookieParser());

  // The API sits behind the Next.js proxy in development and a load balancer in
  // production, so `req.ip` is the proxy's address unless X-Forwarded-For is
  // trusted. Rate limiting buckets by IP, so getting this wrong would put every
  // user in one bucket. `1` trusts exactly one hop — trusting all of them would
  // let a client spoof its own address through a forged header.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  // URI versioning: routes resolve as /api/v1/<route>. Adding a v2 later is a
  // controller-level decorator change, not a rewrite of the route table.
  app.setGlobalPrefix(API_GLOBAL_PREFIX);
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: API_VERSION.replace('v', ''),
  });

  app.useGlobalPipes(createValidationPipe());
}

/**
 * Terminal handler for paths no controller matched.
 *
 * Nest's exception filter only sees requests that reached the framework;
 * without this, an unmatched URL falls through to Express and the client gets
 * an HTML error page instead of the documented JSON envelope. Must be
 * registered after `app.init()`, once Nest's routes are in place.
 */
export function registerNotFoundHandler(app: INestApplication): void {
  const server = app.getHttpAdapter().getInstance() as {
    use: (handler: (req: Request, res: Response, next: NextFunction) => void) => void;
  };

  server.use((req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next();

    res
      .status(404)
      .json(
        buildErrorResponse(
          ERROR_CODES.NOT_FOUND,
          `Cannot ${req.method} ${req.path}`,
          getRequestId(req),
        ),
      );
  });
}
