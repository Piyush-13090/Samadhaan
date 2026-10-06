import { Injectable } from '@nestjs/common';
import type { MapAggregateCollection, MapProblemCollection } from '@samadhaan/shared';
import { Prisma } from '../generated/prisma/client.js';
import { ProblemMapService } from '../problems/services/problem-map.service.js';
import type { GovernmentScope } from './government-access.service.js';
import type { GovernmentMapQueryDto } from './government.dto.js';

/**
 * The government map: Prompt 12's viewport queries, with the jurisdiction
 * predicate and review filters appended. Not a second map implementation —
 * the same SQL, index use and GeoJSON, scoped.
 */
@Injectable()
export class GovernmentMapService {
  constructor(private readonly maps: ProblemMapService) {}

  problems(
    scope: GovernmentScope,
    query: GovernmentMapQueryDto,
  ): Promise<MapProblemCollection> {
    return this.maps.problems(query, this.scopeFor(scope, query));
  }

  aggregate(
    scope: GovernmentScope,
    query: GovernmentMapQueryDto,
  ): Promise<MapAggregateCollection> {
    return this.maps.aggregate(query, undefined, this.scopeFor(scope, query));
  }

  private scopeFor(scope: GovernmentScope, query: GovernmentMapQueryDto) {
    const conditions: Prisma.Sql[] = [scope.jurisdiction.condition];

    const openCandidates = Prisma.sql`EXISTS (
      SELECT 1 FROM problem_duplicate_candidates d
      WHERE d."problemId" = p.id AND d.status IN ('PENDING', 'LIKELY_DUPLICATE')
    )`;
    if (query.duplicate === 'possible') conditions.push(openCandidates);
    if (query.duplicate === 'none') conditions.push(Prisma.sql`NOT ${openCandidates}`);

    if (query.aiStatus) {
      const latest = Prisma.sql`(
        SELECT a."processingStatus" FROM problem_ai_analyses a
        WHERE a."problemId" = p.id AND a."analysisType" = 'INITIAL_ANALYSIS'
        ORDER BY a."createdAt" DESC LIMIT 1
      )`;
      conditions.push(
        query.aiStatus === 'completed'
          ? Prisma.sql`${latest} = 'COMPLETED'`
          : query.aiStatus === 'failed'
            ? Prisma.sql`${latest} = 'FAILED'`
            : query.aiStatus === 'pending'
              ? Prisma.sql`${latest} IN ('PENDING', 'PROCESSING')`
              : Prisma.sql`${latest} IS NULL`,
      );
    }

    if (query.reportedWithinDays) {
      const cutoff = new Date(Date.now() - query.reportedWithinDays * 86_400_000);
      conditions.push(Prisma.sql`p."createdAt" >= ${cutoff}`);
    }

    return { conditions, anyStatus: true };
  }
}
