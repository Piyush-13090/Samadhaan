import type { NextFunction, Request, Response } from 'express';
import type { MetricsService } from './metrics.service.js';

/**
 * Records every HTTP request's latency and status class against its route
 * *template* (`/api/v1/problems/:publicId`), never the concrete URL, so ids
 * and query strings never become label values (Prompt 30).
 */
export function httpMetrics(metrics: MetricsService) {
  return (req: Request, res: Response, next: NextFunction) => {
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const route = req.route?.path
        ? `${req.baseUrl ?? ''}${String(req.route.path)}`
        : 'unmatched';
      const labels = { method: req.method, route };
      metrics.httpRequests.inc({
        ...labels,
        status: `${Math.floor(res.statusCode / 100)}xx`,
      });
      metrics.httpDuration.observe(
        labels,
        Number(process.hrtime.bigint() - started) / 1e9,
      );
    });
    next();
  };
}
