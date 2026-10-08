import { Injectable } from '@nestjs/common';
import type { CitizenAnalytics, OrganizationAnalytics } from '@samadhaan/shared';
import { AppConfig } from '../config/app.config.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import type { WorkspaceContext } from '../organizations/organization-access.service.js';
import { AnalyticsCacheService } from './analytics-cache.service.js';
import { MIN_OBSERVATIONS, enoughDays, ratePct, round } from './analytics-metrics.js';
import { maybe, num } from './analytics-sql.js';
import {
  bucketLabel,
  bucketSql,
  bucketStarts,
  daysSql,
  resolvePeriod,
  trueInstant,
} from './analytics-time.js';
import type { AnalyticsPeriodDto } from './analytics.dto.js';

type Row = Record<string, unknown>;

/**
 * An organisation's own delivery analytics (Prompt 24) — for its members
 * only (OrganizationWorkspaceGuard), about its own projects. There is no
 * comparison with, or ranking against, any other organisation.
 */
@Injectable()
export class OrganizationAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly cache: AnalyticsCacheService,
  ) {}

  summary(
    workspace: WorkspaceContext,
    query: AnalyticsPeriodDto,
  ): Promise<OrganizationAnalytics> {
    const resolved = resolvePeriod(query, this.config.analytics.timezone);
    const { period, start, end } = resolved;
    const org = workspace.organization.id;

    return this.cache.wrap(['org', org, period], async () => {
      const tz = period.timezone;
      const g = period.granularity;
      const completion = daysSql(
        Prisma.sql`COALESCE(r."startedAt", r."createdAt")`,
        Prisma.sql`r."completedAt"`,
      );
      const [[row], trend] = await Promise.all([
        this.prisma.$queryRaw<Row[]>(Prisma.sql`
          SELECT
            (SELECT count(*)::int FROM problem_allocations a
              WHERE a."organizationId" = ${org}::uuid AND a."acceptedAt" IS NOT NULL
                AND a."acceptedAt" >= ${start} AND a."acceptedAt" < ${end}) AS assigned,
            (SELECT count(*)::int FROM resolution_projects r
              WHERE r."assignedOrganizationId" = ${org}::uuid
                AND r.status IN ('PLANNED','ACTIVE','PAUSED')) AS active,
            (SELECT count(*)::int FROM resolution_projects r
              WHERE r."assignedOrganizationId" = ${org}::uuid AND r.status = 'COMPLETED'
                AND r."completedAt" >= ${start} AND r."completedAt" < ${end}) AS completed,
            (SELECT avg(GREATEST(0, ${completion}))::float8 FROM resolution_projects r
              WHERE r."assignedOrganizationId" = ${org}::uuid AND r.status = 'COMPLETED'
                AND r."completedAt" >= ${start} AND r."completedAt" < ${end}) AS "avgDays",
            (SELECT count(*) FILTER (
                      WHERE (${trueInstant(Prisma.sql`r."completedAt"`)} AT TIME ZONE ${tz})::date
                            <= r."targetDate")::int
              FROM resolution_projects r
              WHERE r."assignedOrganizationId" = ${org}::uuid AND r.status = 'COMPLETED'
                AND r."targetDate" IS NOT NULL
                AND r."completedAt" >= ${start} AND r."completedAt" < ${end}) AS "onTime",
            (SELECT count(*)::int FROM resolution_projects r
              WHERE r."assignedOrganizationId" = ${org}::uuid AND r.status = 'COMPLETED'
                AND r."targetDate" IS NOT NULL
                AND r."completedAt" >= ${start} AND r."completedAt" < ${end}) AS "withTarget",
            (SELECT count(*)::int FROM resolution_tasks t
              JOIN resolution_projects r ON r.id = t."projectId"
              WHERE r."assignedOrganizationId" = ${org}::uuid AND t.status = 'COMPLETED'
                AND t."completedAt" >= ${start} AND t."completedAt" < ${end}) AS "tasksDone",
            (SELECT count(*)::int FROM resolution_tasks t
              JOIN resolution_projects r ON r.id = t."projectId"
              WHERE r."assignedOrganizationId" = ${org}::uuid
                AND r.status IN ('PLANNED','ACTIVE','PAUSED')
                AND t.status IN ('TODO','IN_PROGRESS','BLOCKED')) AS "tasksOpen",
            (SELECT count(*)::int FROM resolution_evidence e
              WHERE e."organizationId" = ${org}::uuid
                AND e."submittedAt" >= ${start} AND e."submittedAt" < ${end}) AS evidence,
            (SELECT count(*)::int FROM resolution_evidence e
              WHERE e."organizationId" = ${org}::uuid AND e.status = 'APPROVED'
                AND e."decidedAt" >= ${start} AND e."decidedAt" < ${end}) AS approved,
            (SELECT count(*)::int FROM resolution_evidence e
              WHERE e."organizationId" = ${org}::uuid AND e.status = 'REJECTED'
                AND e."decidedAt" >= ${start} AND e."decidedAt" < ${end}) AS rejected,
            (SELECT count(*)::int FROM resolution_verification_requests v
              JOIN resolution_projects r ON r.id = v."projectId"
              WHERE r."assignedOrganizationId" = ${org}::uuid AND v.status = 'APPROVED'
                AND v."decidedAt" >= ${start} AND v."decidedAt" < ${end}) AS approvals
        `),
        this.prisma.$queryRaw<
          Array<{ kind: string; bucket: string; count: number }>
        >(Prisma.sql`
          SELECT kind, bucket, count(*)::int AS count FROM (
            SELECT 'task' AS kind, ${bucketSql(Prisma.sql`t."completedAt"`, g, tz)} AS bucket
            FROM resolution_tasks t JOIN resolution_projects r ON r.id = t."projectId"
            WHERE r."assignedOrganizationId" = ${org}::uuid AND t.status = 'COMPLETED'
              AND t."completedAt" >= ${start} AND t."completedAt" < ${end}
            UNION ALL
            SELECT 'project', ${bucketSql(Prisma.sql`r."completedAt"`, g, tz)}
            FROM resolution_projects r
            WHERE r."assignedOrganizationId" = ${org}::uuid AND r.status = 'COMPLETED'
              AND r."completedAt" >= ${start} AND r."completedAt" < ${end}
          ) e GROUP BY 1, 2
        `),
      ]);

      const completed = num(row.completed);
      const withTarget = num(row.withTarget);
      const decided = num(row.approved) + num(row.rejected);
      const byBucket = new Map<string, { task: number; project: number }>();
      for (const item of trend) {
        const entry = byBucket.get(item.bucket) ?? { task: 0, project: 0 };
        entry[item.kind as 'task' | 'project'] = item.count;
        byBucket.set(item.bucket, entry);
      }
      return {
        period,
        generatedAt: new Date().toISOString(),
        problemsAssigned: num(row.assigned),
        projectsActive: num(row.active),
        projectsCompleted: completed,
        avgCompletionDays: enoughDays(maybe(row.avgDays), completed),
        onTimeRate:
          withTarget >= MIN_OBSERVATIONS ? ratePct(num(row.onTime), withTarget) : null,
        onTimeObservations: withTarget,
        tasksCompleted: num(row.tasksDone),
        openTasks: num(row.tasksOpen),
        evidenceSubmitted: num(row.evidence),
        evidenceApprovalRate:
          decided >= MIN_OBSERVATIONS ? ratePct(num(row.approved), decided) : null,
        governmentApprovals: num(row.approvals),
        trend: bucketStarts(period).map((startDate) => ({
          start: startDate,
          label: bucketLabel(startDate, g),
          tasksCompleted: byBucket.get(startDate)?.task ?? 0,
          projectsCompleted: byBucket.get(startDate)?.project ?? 0,
        })),
      };
    });
  }

  /** A citizen's own reports and their outcomes, all time. Never anyone else's. */
  async citizen(userId: string): Promise<CitizenAnalytics> {
    const [row] = await this.prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT
        count(*)::int AS reported,
        count(*) FILTER (WHERE p.status IN ('VERIFIED','IN_PROGRESS','RESOLVED'))::int AS verified,
        count(*) FILTER (WHERE p.status = 'RESOLVED')::int AS resolved,
        count(*) FILTER (WHERE p.status = 'IN_PROGRESS')::int AS "inProgress",
        count(*) FILTER (WHERE p.status IN ('SUBMITTED','UNDER_REVIEW'))::int AS awaiting,
        count(*) FILTER (WHERE p.status = 'DUPLICATE')::int AS duplicates,
        percentile_cont(0.5) WITHIN GROUP (
          ORDER BY CASE WHEN p.status = 'RESOLVED' AND p."resolvedAt" IS NOT NULL
            THEN GREATEST(0, ${daysSql(Prisma.sql`p."createdAt"`, Prisma.sql`p."resolvedAt"`)}) END
        )::float8 AS "medianDays",
        COALESCE(sum(p."voteCount"), 0)::int AS supporters,
        (SELECT COALESCE(s."impactPoints", 0)::int FROM user_impact_stats s
          WHERE s."userId" = ${userId}::uuid) AS points
      FROM problems p
      WHERE p."reporterId" = ${userId}::uuid AND p."deletedAt" IS NULL AND p.status <> 'DRAFT'
    `);
    const median = maybe(row.medianDays);
    return {
      reported: num(row.reported),
      verified: num(row.verified),
      resolved: num(row.resolved),
      inProgress: num(row.inProgress),
      awaitingReview: num(row.awaiting),
      confirmedDuplicates: num(row.duplicates),
      medianDaysToResolution: median === null ? null : round(Math.max(0, median)),
      supportersOnMyReports: num(row.supporters),
      impactPoints: num(row.points),
      generatedAt: new Date().toISOString(),
    };
  }
}
