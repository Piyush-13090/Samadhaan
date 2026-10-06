import { Injectable } from '@nestjs/common';
import type { KnowledgeAuthoring, KnowledgeVisibility } from '@samadhaan/shared';
import type { RequestUser } from '../auth/auth.types.js';
import { AppException } from '../common/app.exception.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma, type KnowledgeSource } from '../generated/prisma/client.js';
import { OrganizationAccessService } from '../organizations/organization-access.service.js';
import { ProjectsService } from '../resolution/projects.service.js';

/**
 * Who may read a knowledge source, as a SQL predicate over `knowledge_sources s`.
 *
 *   PUBLIC        every signed-in user
 *   GOVERNMENT    GOVERNMENT-role, ACTIVE members of the owning office
 *   ORGANIZATION  ACTIVE members of the owning (operational) organisation
 *   PROJECT       only inside that project's context, after the project's
 *                 own access check (room participants) — never in a general query
 *   PRIVATE       the uploader alone
 *
 * Built from the database for each request; applied inside the retrieval SQL,
 * so no unauthorised chunk is ever loaded, scored or sent to a model.
 */
export interface KnowledgeScope {
  userId: string;
  /** Government offices the user is an official of. */
  officeIds: string[];
  /** Non-government organisations the user is an active member of. */
  organizationIds: string[];
  /** A project the caller has proven access to, for PROJECT sources. */
  projectId: string | null;
  /** Restrict to these visibilities (e.g. the coordinator: PUBLIC + PROJECT). */
  only?: KnowledgeVisibility[];
}

export interface Memberships {
  offices: Array<{ id: string; name: string; role: string }>;
  organizations: Array<{ id: string; name: string; role: string }>;
}

@Injectable()
export class KnowledgeAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
  ) {}

  async memberships(user: RequestUser): Promise<Memberships> {
    const rows = await this.prisma.organizationMember.findMany({
      where: { userId: user.id, status: 'ACTIVE', organization: { deletedAt: null } },
      include: { organization: true },
    });
    const live = rows.filter((row) =>
      OrganizationAccessService.isOperational(row.organization),
    );
    return {
      offices:
        user.role === 'GOVERNMENT'
          ? live
              .filter((row) => row.organization.type === 'GOVERNMENT')
              .map((row) => ({
                id: row.organizationId,
                name: row.organization.name,
                role: row.membershipRole,
              }))
          : [],
      organizations: live
        .filter((row) => row.organization.type !== 'GOVERNMENT')
        .map((row) => ({
          id: row.organizationId,
          name: row.organization.name,
          role: row.membershipRole,
        })),
    };
  }

  async scope(
    user: RequestUser,
    projectId: string | null = null,
  ): Promise<KnowledgeScope> {
    const m = await this.memberships(user);
    if (projectId) await this.projects.resolve(projectId, user); // 404 unless a participant
    return {
      userId: user.id,
      officeIds: m.offices.map((o) => o.id),
      organizationIds: m.organizations.map((o) => o.id),
      projectId,
    };
  }

  /** The predicate. Every branch names its owner; there is no "else visible". */
  predicate(scope: KnowledgeScope): Prisma.Sql {
    const allowed = (v: KnowledgeVisibility) => !scope.only || scope.only.includes(v);
    const branches: Prisma.Sql[] = [];
    if (allowed('PUBLIC')) branches.push(Prisma.sql`s."visibility" = 'PUBLIC'`);
    if (allowed('GOVERNMENT') && scope.officeIds.length > 0) {
      branches.push(
        Prisma.sql`(s."visibility" = 'GOVERNMENT' AND s."organizationId" = ANY(${scope.officeIds}::uuid[]))`,
      );
    }
    if (allowed('ORGANIZATION') && scope.organizationIds.length > 0) {
      branches.push(
        Prisma.sql`(s."visibility" = 'ORGANIZATION' AND s."organizationId" = ANY(${scope.organizationIds}::uuid[]))`,
      );
    }
    if (allowed('PROJECT') && scope.projectId) {
      branches.push(
        Prisma.sql`(s."visibility" = 'PROJECT' AND s."projectId" = ${scope.projectId}::uuid)`,
      );
    }
    if (allowed('PRIVATE')) {
      branches.push(
        Prisma.sql`(s."visibility" = 'PRIVATE' AND s."uploadedById" = ${scope.userId}::uuid)`,
      );
    }
    return branches.length
      ? Prisma.sql`(${Prisma.join(branches, ' OR ')})`
      : Prisma.sql`false`;
  }

  /** The same rule as a Prisma filter, for listings. */
  where(scope: KnowledgeScope): Prisma.KnowledgeSourceWhereInput {
    return {
      OR: [
        { visibility: 'PUBLIC' },
        { visibility: 'GOVERNMENT', organizationId: { in: scope.officeIds } },
        { visibility: 'ORGANIZATION', organizationId: { in: scope.organizationIds } },
        ...(scope.projectId
          ? [{ visibility: 'PROJECT' as const, projectId: scope.projectId }]
          : []),
        { visibility: 'PRIVATE', uploadedById: scope.userId },
      ],
    };
  }

  /** Reads one source, or 404 — identical for "missing" and "not yours". */
  async readable(sourceId: string, user: RequestUser): Promise<KnowledgeSource> {
    const source = await this.prisma.knowledgeSource.findUnique({
      where: { id: sourceId },
    });
    if (!source) throw AppException.notFound('Knowledge source');
    const scope = await this.scopeFor(source, user);
    const visible = await this.prisma.knowledgeSource.count({
      where: { AND: [{ id: sourceId }, this.where(scope)] },
    });
    if (!visible) throw AppException.notFound('Knowledge source');
    return source;
  }

  private async scopeFor(
    source: KnowledgeSource,
    user: RequestUser,
  ): Promise<KnowledgeScope> {
    if (source.visibility === 'PROJECT' && source.projectId) {
      try {
        return await this.scope(user, source.projectId);
      } catch {
        throw AppException.notFound('Knowledge source');
      }
    }
    return this.scope(user);
  }

  /**
   * Who may edit, re-ingest or delete: the uploader; OWNER/ADMIN of the owning
   * organisation or office; a platform administrator for unowned PUBLIC sources.
   */
  async canManage(source: KnowledgeSource, user: RequestUser): Promise<boolean> {
    if (source.uploadedById === user.id) return true;
    if (source.organizationId) {
      const m = await this.memberships(user);
      return [...m.offices, ...m.organizations].some(
        (o) =>
          o.id === source.organizationId && (o.role === 'OWNER' || o.role === 'ADMIN'),
      );
    }
    return user.role === 'ADMIN' && source.visibility === 'PUBLIC';
  }

  /** Which scopes the caller may publish to. The API enforces the same rules. */
  async authoring(user: RequestUser): Promise<KnowledgeAuthoring> {
    const m = await this.memberships(user);
    const managed = m.organizations.filter(
      (o) => o.role === 'OWNER' || o.role === 'ADMIN',
    );
    const projects = await this.authorableProjects(user, m);
    const visibilities: KnowledgeAuthoring['visibilities'] = [];
    if (user.role === 'ADMIN' || m.offices.length > 0) {
      visibilities.push({
        visibility: 'PUBLIC',
        organizations: m.offices.map(({ id, name }) => ({ id, name })),
        projects: [],
      });
    }
    if (m.offices.length > 0) {
      visibilities.push({
        visibility: 'GOVERNMENT',
        organizations: m.offices.map(({ id, name }) => ({ id, name })),
        projects: [],
      });
    }
    if (managed.length > 0) {
      visibilities.push({
        visibility: 'ORGANIZATION',
        organizations: managed.map(({ id, name }) => ({ id, name })),
        projects: [],
      });
    }
    if (projects.length > 0)
      visibilities.push({ visibility: 'PROJECT', organizations: [], projects });
    visibilities.push({ visibility: 'PRIVATE', organizations: [], projects: [] });
    return { visibilities };
  }

  /**
   * Validates a new source's scope and returns the owning organisation to
   * record. Throws 403 for a scope the caller may not publish to.
   */
  async assertCanCreate(
    user: RequestUser,
    input: {
      visibility: KnowledgeVisibility;
      organizationId: string | null;
      projectId: string | null;
    },
  ): Promise<{ organizationId: string | null; projectId: string | null }> {
    const m = await this.memberships(user);
    const deny = (message: string): never => {
      throw AppException.forbidden(message);
    };
    switch (input.visibility) {
      case 'PUBLIC':
        if (input.organizationId) {
          if (!m.offices.some((o) => o.id === input.organizationId))
            deny('Only officials of that office can publish for it.');
          return { organizationId: input.organizationId, projectId: null };
        }
        if (user.role !== 'ADMIN')
          deny('Public knowledge is published by a government office or Samadhaan.');
        return { organizationId: null, projectId: null };
      case 'GOVERNMENT':
        if (
          !input.organizationId ||
          !m.offices.some((o) => o.id === input.organizationId)
        ) {
          deny('Government knowledge belongs to an office you are an official of.');
        }
        return { organizationId: input.organizationId, projectId: null };
      case 'ORGANIZATION':
        if (
          !input.organizationId ||
          !m.organizations.some(
            (o) =>
              o.id === input.organizationId && (o.role === 'OWNER' || o.role === 'ADMIN'),
          )
        ) {
          deny('Organisation knowledge is managed by its owners and admins.');
        }
        return { organizationId: input.organizationId, projectId: null };
      case 'PROJECT': {
        if (!input.projectId)
          throw AppException.badRequest('Choose the project this document belongs to.');
        const context = await this.projects.resolve(input.projectId, user);
        const side = context.room.side;
        if (side === 'ORGANIZATION' && !context.canManage)
          deny('Project documents are added by owners, admins and officials.');
        return {
          organizationId: context.room.organization.id,
          projectId: input.projectId,
        };
      }
      case 'PRIVATE':
        return { organizationId: null, projectId: null };
    }
  }

  private async authorableProjects(
    user: RequestUser,
    m: Memberships,
  ): Promise<Array<{ id: string; name: string }>> {
    const managed = m.organizations
      .filter((o) => o.role === 'OWNER' || o.role === 'ADMIN')
      .map((o) => o.id);
    const candidates = await this.prisma.resolutionProject.findMany({
      where: {
        status: { in: ['PLANNED', 'ACTIVE', 'PAUSED'] },
        OR: [
          { assignedOrganizationId: { in: managed } },
          { governmentOrganizationId: { in: m.offices.map((o) => o.id) } },
        ],
      },
      select: { id: true, name: true },
      orderBy: { updatedAt: 'desc' },
      take: 30,
    });
    // Confirm each with the project's own access rule (jurisdiction included).
    const confirmed: Array<{ id: string; name: string }> = [];
    for (const project of candidates) {
      try {
        await this.projects.resolve(project.id, user);
        confirmed.push(project);
      } catch {
        // not accessible now
      }
    }
    return confirmed;
  }
}
