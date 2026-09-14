import { Injectable } from '@nestjs/common';
import type { CitizenDashboard } from '@samadhaan/shared';
import type { RequestUser } from '../auth/auth.types.js';
import { PrismaService } from '../database/prisma.service.js';
import { ProblemDiscoveryService } from '../problems/services/problem-discovery.service.js';
import { UsersRepository } from '../users/users.repository.js';

/** How many of the citizen's own reports the dashboard shows before "view all". */
const RECENT_REPORT_COUNT = 5;

/**
 * Assembles the citizen dashboard in one response.
 *
 * One endpoint rather than four, deliberately. A dashboard that fans out to a
 * request per section is slowest on exactly the connection a civic app gets
 * used on — a phone on mobile data, outdoors. The three reads here run
 * concurrently and the whole page costs one round trip.
 *
 * Nearby problems are *not* part of this. They depend on a location only the
 * browser knows, and folding them in would mean either blocking the dashboard
 * on a permission prompt or returning a section the server cannot fill.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersRepository,
    private readonly discovery: ProblemDiscoveryService,
  ) {}

  async forCitizen(principal: RequestUser): Promise<CitizenDashboard> {
    const [profile, activity, reports] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: principal.id },
        select: { fullName: true, displayName: true, city: true, state: true },
      }),
      // Reused rather than recounted: the profile page already answers exactly
      // this question, and two implementations of "problems reported" would
      // eventually disagree.
      this.users.getActivity(principal.id),
      this.discovery.listOwn(principal.id, { sort: 'recent', limit: RECENT_REPORT_COUNT }),
    ]);

    const name = profile?.displayName ?? profile?.fullName ?? 'there';

    return {
      user: {
        name,
        // The greeting uses one word. Splitting here rather than in the UI
        // keeps "what do we call this person" a single decision.
        firstName: name.split(' ')[0] ?? name,
        city: profile?.city ?? null,
        state: profile?.state ?? null,
      },
      activity,
      recentReports: reports.items,
      reportCount: reports.totalCount,
    };
  }
}
