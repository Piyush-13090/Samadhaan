import { Controller, Get, Req, Res } from '@nestjs/common';
import { API_VERSION } from '@samadhaan/shared';
import type { Request, Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { Public } from '../auth/decorators/public.decorator.js';
import { AppConfig } from '../config/app.config.js';
import { MetricsService } from './metrics.service.js';

/**
 * Prometheus scrape endpoint (Prompt 30). Not a user session route: it is
 * authenticated by `Authorization: Bearer <METRICS_TOKEN>` (constant-time
 * comparison). With no METRICS_TOKEN configured it does not exist (404), so a
 * deployment that has not set up scraping exposes nothing.
 */
@Public()
@Controller({ path: 'metrics', version: API_VERSION.replace('v', '') })
export class MetricsController {
  constructor(
    private readonly metrics: MetricsService,
    private readonly config: AppConfig,
  ) {}

  @Get()
  scrape(@Req() req: Request, @Res() res: Response): void {
    const token = this.config.metricsToken;
    const header = req.headers.authorization ?? '';
    const given = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) {
      res
        .status(404)
        .json({ success: false, error: { code: 'NOT_FOUND', message: 'Not found' } });
      return;
    }
    const a = Buffer.from(given);
    const b = Buffer.from(token);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      });
      return;
    }
    res
      .status(200)
      .type('text/plain; version=0.0.4; charset=utf-8')
      .send(this.metrics.render());
  }
}
