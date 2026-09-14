import { Controller, Get } from '@nestjs/common';
import { API_VERSION, type CitizenDashboard } from '@samadhaan/shared';
import type { RequestUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { DashboardService } from './dashboard.service.js';

@Controller({ path: 'dashboard', version: API_VERSION.replace('v', '') })
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  /**
   * Everything the citizen home page needs.
   *
   * Authenticated, and scoped entirely to the caller: the principal comes from
   * the verified token and there is no parameter that could point it elsewhere.
   * Deliberately not role-restricted — an admin or an organisation account
   * still has their own reports and their own activity, and refusing them a
   * home page would be arbitrary.
   */
  @Get('citizen')
  citizen(@CurrentUser() user: RequestUser): Promise<CitizenDashboard> {
    return this.dashboard.forCitizen(user);
  }
}
