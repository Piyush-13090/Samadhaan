import { Injectable } from '@nestjs/common';
import type { RequestUser } from '../auth/auth.types.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import {
  GovernmentAccessService,
  type GovernmentScope,
} from '../government/government-access.service.js';
import { resolveJurisdiction } from '../government/jurisdiction.js';
import {
  KnowledgeAccessService,
  type KnowledgeScope,
} from '../knowledge/knowledge-access.service.js';
import { AnalyticsCacheService } from '../analytics/analytics-cache.service.js';

/**
 * Who may discover what through search (Prompt 25). Every entity type has an
 * explicit policy, expressed as SQL that candidate retrieval includes — rows
 * the caller may not see are never fetched, scored or cached for them.
 *
 * | Entity       | Policy                                                                 |
 * | ------------ | ---------------------------------------------------------------------- |
 * | Problem      | Published civic reports: not draft, not deleted, not merged duplicates. |
 * |              | `office` narrows to an official's own jurisdiction (GovernmentGuard rules). |
 * | Organisation | Public profiles: active, not deleted, not suspended or rejected.        |
 * | Knowledge    | The Prompt 20 visibility predicate (public, own office/org, own private, |
 * |              | a project the caller is proven to participate in).                      |
 * | Project      | Members of the assigned organisation, or officials of the government    |
 * |              | office within its jurisdiction — exactly the resolution-room rule.      |
 */
@Injectable()
export class SearchAuthorizationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly government: GovernmentAccessService,
    private readonly knowledge: KnowledgeAccessService,
  ) {}

  // ---------------------------------------------------------------- problems

  /** Over a problem aliased `p`. */
  problemPredicate(): Prisma.Sql {
    return Prisma.sql`p."deletedAt" IS NULL AND p."status" <> 'DRAFT' AND p."duplicateOfId" IS NULL`;
  }

  /** An official narrowing search to their office (404/403 as the portal answers). */
  async office(slug: string, user: RequestUser): Promise<GovernmentScope> {
    return this.government.resolve(slug, user);
  }

  // ----------------------------------------------------------- organisations

  /** Over an organisation aliased `o`. */
  organizationPredicate(): Prisma.Sql {
    return Prisma.sql`o."deletedAt" IS NULL AND o."isActive" = true
      AND o."verificationStatus" IN ('VERIFIED', 'PENDING')`;
  }

  // --------------------------------------------------------------- knowledge

  /** The caller's knowledge scope; `projectId` is honoured only for a participant. */
  knowledgeScope(user: RequestUser, projectId: string | null): Promise<KnowledgeScope> {
    return this.knowledge.scope(user, projectId);
  }

  knowledgePredicate(scope: KnowledgeScope): Prisma.Sql {
    return this.knowledge.predicate(scope);
  }

  // ---------------------------------------------------------------- projects

  /**
   * Over a project aliased `r` joined to its problem `p`. `false` when the
   * caller belongs to no operational organisation — citizens see no projects.
   */
  async projectPredicate(user: RequestUser): Promise<Prisma.Sql> {
    const memberships = await this.prisma.organizationMember.findMany({
      where: { userId: user.id, status: 'ACTIVE', organization: { deletedAt: null } },
      include: { organization: true },
    });
    const operational = memberships.filter(
      ({ organization: o }) => o.isActive && o.verificationStatus !== 'SUSPENDED',
    );
    const branches: Prisma.Sql[] = [];

    const assigned = operational
      .filter((m) => m.organization.type !== 'GOVERNMENT')
      .map((m) => m.organizationId);
    if (assigned.length > 0) {
      branches.push(Prisma.sql`r."assignedOrganizationId" = ANY(${assigned}::uuid[])`);
    }

    if (user.role === 'GOVERNMENT') {
      for (const m of operational.filter((x) => x.organization.type === 'GOVERNMENT')) {
        const jurisdiction = await resolveJurisdiction(this.prisma, m.organizationId);
        branches.push(
          Prisma.sql`(r."governmentOrganizationId" = ${m.organizationId}::uuid AND ${jurisdiction.condition})`,
        );
      }
    }
    return branches.length > 0
      ? Prisma.sql`(p."deletedAt" IS NULL AND (${Prisma.join(branches, ' OR ')}))`
      : Prisma.sql`false`;
  }

  /** A stable fingerprint of a predicate, for cache keys. */
  static fingerprint(sql: Prisma.Sql): string {
    return AnalyticsCacheService.jurisdictionKey(sql);
  }
}
