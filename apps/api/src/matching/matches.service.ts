import { Injectable } from '@nestjs/common';
import {
  ACTIVE_PROBLEM_STATUSES,
  isWorkspaceOrganizationType,
  type ProblemMatches,
} from '@samadhaan/shared';
import { AppException } from '../common/app.exception.js';
import { AppConfig } from '../config/app.config.js';
import { PrismaService } from '../database/prisma.service.js';
import { toMatchEvidence } from './match.serializer.js';
import { OrganizationMatchingService } from './organization-matching.service.js';

/**
 * Reads of a problem's organisation matches, and the admin recompute.
 *
 * Public: a problem is a public civic record and organisation profiles are
 * public, so "who might be able to help" is too. Only public organisation
 * facts leave this service — no contact details, no members, no coordinates —
 * and organisations that are suspended, rejected or deactivated are never
 * listed, whatever their score.
 */
@Injectable()
export class MatchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly matching: OrganizationMatchingService,
  ) {}

  async forProblem(publicId: string, limit: number): Promise<ProblemMatches> {
    const problem = await this.prisma.problem.findFirst({
      where: { publicId, deletedAt: null, status: { not: 'DRAFT' } },
      select: { id: true, status: true, duplicateOfId: true },
    });
    if (!problem) throw AppException.notFound('Problem');

    const eligible =
      this.config.matching.enabled &&
      problem.duplicateOfId === null &&
      (ACTIVE_PROBLEM_STATUSES as readonly string[]).includes(problem.status);

    if (!eligible) {
      return { state: 'unavailable', matchingVersion: null, computedAt: null, items: [] };
    }

    const [rows, lastJob] = await Promise.all([
      this.prisma.organizationProblemMatch.findMany({
        where: {
          problemId: problem.id,
          status: { in: ['CALCULATED', 'STALE'] },
          organization: {
            deletedAt: null,
            isActive: true,
            type: { in: ['NGO', 'UNIVERSITY', 'INDUSTRY'] },
            verificationStatus: { notIn: ['SUSPENDED', 'REJECTED'] },
          },
        },
        orderBy: [{ finalScore: 'desc' }, { organizationId: 'asc' }],
        take: limit,
        include: {
          organization: {
            select: {
              slug: true,
              name: true,
              type: true,
              logoUrl: true,
              verificationStatus: true,
              city: true,
              state: true,
            },
          },
        },
      }),
      this.prisma.problemAiAnalysis.findFirst({
        where: { problemId: problem.id, analysisType: 'ORGANIZATION_MATCHING' },
        orderBy: { createdAt: 'desc' },
        select: { processingStatus: true, modelVersion: true, updatedAt: true },
      }),
    ]);

    const running =
      lastJob === null ||
      lastJob.processingStatus === 'PENDING' ||
      lastJob.processingStatus === 'PROCESSING';

    return {
      state: rows.length === 0 && running ? 'pending' : 'ready',
      matchingVersion:
        lastJob?.processingStatus === 'COMPLETED' ? lastJob.modelVersion : null,
      computedAt: rows[0]?.updatedAt.toISOString() ?? null,
      items: rows
        .flatMap((row) => {
          const type = row.organization.type;
          if (!isWorkspaceOrganizationType(type)) return [];
          return [
            {
              ...toMatchEvidence(row),
              // Re-ranked within what is shown, so filtered-out rows leave no gaps.
              organization: {
                slug: row.organization.slug,
                name: row.organization.name,
                type,
                logoUrl: row.organization.logoUrl,
                verificationStatus: row.organization.verificationStatus,
                location: { city: row.organization.city, state: row.organization.state },
              },
            },
          ];
        })
        .map((item, index) => ({ ...item, rank: index + 1 })),
    };
  }

  /** Queues a fresh match. Platform administrators only (enforced by the controller). */
  async recompute(publicId: string): Promise<void> {
    const problem = await this.prisma.problem.findFirst({
      where: { publicId, deletedAt: null },
      select: { id: true },
    });
    if (!problem) throw AppException.notFound('Problem');
    if (!this.config.matching.enabled) {
      throw AppException.upstreamUnavailable(
        'Matching',
        'Organisation matching is switched off.',
      );
    }
    this.matching.enqueue(problem.id, 'recompute');
  }
}
