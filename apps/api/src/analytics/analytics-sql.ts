import type { AnalyticsFilters } from '@samadhaan/shared';
import { Prisma } from '../generated/prisma/client.js';
import { daysSql } from './analytics-time.js';

/**
 * SQL building blocks for analytics (Prompt 24). Every value is a bound
 * parameter; nothing from the request is interpolated as text.
 */

export const OPEN_STATUSES = [
  'SUBMITTED',
  'UNDER_REVIEW',
  'VERIFIED',
  'IN_PROGRESS',
] as const;

/** An official's override wins over the AI tier (the Prompt 21 rule). */
export const EFFECTIVE_TIER = Prisma.sql`COALESCE(
  (SELECT o."priorityTier" FROM problem_priority_overrides o WHERE o."problemId" = p.id),
  p."priorityTier"
)`;

/** Live, non-draft problems matching the filters, over a problem aliased `p`. */
export function filterSql(filters: AnalyticsFilters): Prisma.Sql {
  const parts = [Prisma.sql`p."deletedAt" IS NULL`, Prisma.sql`p.status <> 'DRAFT'`];
  if (filters.category) {
    parts.push(Prisma.sql`p.category = ${filters.category}::"ProblemCategory"`);
  }
  if (filters.severity) {
    parts.push(Prisma.sql`p.severity = ${filters.severity}::"ProblemSeverity"`);
  }
  if (filters.status)
    parts.push(Prisma.sql`p.status = ${filters.status}::"ProblemStatus"`);
  if (filters.priority) {
    parts.push(Prisma.sql`${EFFECTIVE_TIER} = ${filters.priority}::"PriorityTier"`);
  }
  if (filters.city) parts.push(Prisma.sql`lower(p.city) = lower(${filters.city})`);
  if (filters.area) {
    parts.push(
      Prisma.sql`upper(replace(p."postalCode", ' ', '')) = upper(replace(${filters.area}, ' ', ''))`,
    );
  }
  return Prisma.join(parts, ' AND ');
}

/**
 * `t`: one row per problem reported in [start, end) and inside `where`, with
 * the moments it reached each stage — from the audit log (status changes) and
 * the allocations table. Seeded or imported records without an audit trail
 * have null stage times and are left out of duration metrics, not guessed.
 */
export function timeline(where: Prisma.Sql, start: Date, end: Date): Prisma.Sql {
  return Prisma.sql`
    WITH t AS (
      SELECT
        p.id,
        p.status::text                AS status,
        p.category::text              AS category,
        p.severity::text              AS severity,
        ${EFFECTIVE_TIER}::text       AS tier,
        p."createdAt"                 AS reported_at,
        p."resolvedAt"                AS resolved_at,
        sc.review_at,
        sc.verified_at,
        sc.in_progress_at,
        al.allocated_at,
        al.accepted_at,
        (p.status IN ('VERIFIED','IN_PROGRESS','RESOLVED') OR sc.verified_at IS NOT NULL)
                                      AS verified_f
      FROM problems p
      LEFT JOIN LATERAL (
        SELECT
          min(a."createdAt") FILTER (WHERE a.metadata->>'to' = 'UNDER_REVIEW') AS review_at,
          min(a."createdAt") FILTER (WHERE a.metadata->>'to' = 'VERIFIED')     AS verified_at,
          min(a."createdAt") FILTER (WHERE a.metadata->>'to' = 'IN_PROGRESS')  AS in_progress_at
        FROM audit_logs a
        WHERE a."entityType" = 'Problem'
          AND a."entityId" = p.id
          AND a.action = 'PROBLEM_STATUS_CHANGED'
      ) sc ON true
      LEFT JOIN LATERAL (
        SELECT min(pa."proposedAt") AS allocated_at, min(pa."acceptedAt") AS accepted_at
        FROM problem_allocations pa
        WHERE pa."problemId" = p.id
      ) al ON true
      WHERE ${where}
        AND p."createdAt" >= ${start}
        AND p."createdAt" < ${end}
    )`;
}

/** Days between two columns of `t`, or null when either is missing; never negative. */
export function span(from: string, to: string): Prisma.Sql {
  const a = Prisma.raw(from);
  const b = Prisma.raw(to);
  return Prisma.sql`CASE WHEN ${a} IS NOT NULL AND ${b} IS NOT NULL
    THEN GREATEST(0, ${daysSql(a, b)}) END`;
}

/** Resolution days for resolved rows of `t`. */
export const RESOLUTION_DAYS = Prisma.sql`CASE WHEN status = 'RESOLVED' THEN ${span('reported_at', 'resolved_at')} END`;

export const median = (expression: Prisma.Sql) =>
  Prisma.sql`percentile_cont(0.5) WITHIN GROUP (ORDER BY ${expression})`;

export const num = (value: unknown): number => {
  if (value === null || value === undefined) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const maybe = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
