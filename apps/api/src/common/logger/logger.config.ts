import type { Params } from 'nestjs-pino';
import type { AppConfig } from '../../config/app.config.js';
import { resolveRequestId } from '../request-context.js';

/** Headers that must never reach the logs. */
const REDACTED = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-internal-token"]',
  'res.headers["set-cookie"]',
  'req.body.password',
  'req.body.currentPassword',
  'req.body.newPassword',
];

/**
 * The request as logged: method and path only. Query strings carry search text
 * and filters people typed (private content, and unbounded cardinality for
 * anyone aggregating on `url`), so they are dropped (Prompt 27). Per-request
 * latency is pino-http's `responseTime`, in ms, on the completion line.
 */
export function serializeRequest(req: { id?: unknown; method?: string; url?: string }) {
  return { id: req.id, method: req.method, url: (req.url ?? '').split('?')[0] };
}

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
      serializers: { req: serializeRequest },
      // Decided once and stored on the request, so log lines and responses agree.
      genReqId: (req, res) => resolveRequestId(req, res),
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
