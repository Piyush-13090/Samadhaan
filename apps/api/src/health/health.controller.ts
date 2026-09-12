import { Controller, Get, HttpCode, HttpStatus, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { API_VERSION, type HealthReport } from '@samadhaan/shared';
import { Public } from '../auth/decorators/public.decorator.js';
import { getRequestId } from '../common/request-context.js';
import { HealthService } from './health.service.js';

// Unauthenticated: orchestrators and uptime checks must be able to probe the
// API without holding a credential.
@Public()
@Controller({ path: 'health', version: API_VERSION.replace('v', '') })
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /**
   * Full system health: API, PostgreSQL, Redis and the AI service.
   *
   * Returns 200 when everything is `ok` or `degraded`, and 503 when a
   * hard dependency is down — so an orchestrator can act on the status code
   * while a human reads the per-dependency breakdown.
   */
  @Get()
  async getHealth(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<HealthReport> {
    const report = await this.health.getReadiness(getRequestId(request));

    if (report.status === 'down') {
      response.status(HttpStatus.SERVICE_UNAVAILABLE);
    }

    return report;
  }

  /** Liveness probe: cheap, dependency-free, for container restart policies. */
  @Get('live')
  @HttpCode(HttpStatus.OK)
  getLiveness() {
    return this.health.getLiveness();
  }
}
