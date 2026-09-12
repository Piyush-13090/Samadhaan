import { randomUUID } from 'node:crypto';
import type { Params } from 'nestjs-pino';
import { REQUEST_ID_HEADER } from '@samadhaan/shared';
import type { AppConfig } from '../../config/app.config.js';

/** Headers that must never reach the logs. */
const REDACTED = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-internal-token"]',
  'res.headers["set-cookie"]',
];

/**
 * Structured logging configuration.
 *
 * Production emits newline-delimited JSON for log aggregation; development uses
 * `pino-pretty` for readability. Every line carries the request id so a trace
 * can be reassembled across web, API and AI service.
 */
export function createLoggerConfig(config: AppConfig): Params {
  return {
    pinoHttp: {
      level: config.logLevel,
      redact: { paths: REDACTED, remove: true },
      genReqId: (req, res) => {
        const existing = req.headers[REQUEST_ID_HEADER];
        const id = (Array.isArray(existing) ? existing[0] : existing) || randomUUID();
        res.setHeader(REQUEST_ID_HEADER, id);
        return id;
      },
      // Health probes run constantly; logging each one buries real traffic.
      autoLogging: {
        ignore: (req) => req.url?.startsWith('/api/v1/health') ?? false,
      },
      transport: config.isProduction
        ? undefined
        : {
            target: 'pino-pretty',
            options: {
              singleLine: true,
              translateTime: 'HH:MM:ss',
              ignore: 'pid,hostname',
            },
          },
    },
  };
}
