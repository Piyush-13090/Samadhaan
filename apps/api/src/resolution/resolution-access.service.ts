import { Injectable } from '@nestjs/common';
import type { ResolutionParticipantSide } from '@samadhaan/shared';
import type { RequestUser } from '../auth/auth.types.js';
import { AppException } from '../common/app.exception.js';
import { PrismaService } from '../database/prisma.service.js';
import type {
  Organization,
  OrganizationMember,
  ResolutionRoom,
} from '../generated/prisma/client.js';
import { resolveJurisdiction } from '../government/jurisdiction.js';
import { OrganizationAccessService } from '../organizations/organization-access.service.js';
import { Prisma } from '../generated/prisma/client.js';

/** A room, proven accessible to the caller, and the side they speak for. */
export interface RoomContext {
  room: ResolutionRoom & {
    governmentOrganization: Organization;
    assignedOrganization: Organization;
  };
  side: ResolutionParticipantSide;
  /** The organisation the caller participates through. */
  organization: Organization;
  membership: OrganizationMember;
}

/**
 * Who may enter a resolution room. Checked from the database on every request
 * — a room id in a URL is an address, not a credential.
 *
 *   Government side   platform role GOVERNMENT
 *                     + ACTIVE membership of the allocating office
 *                     + the office is operational
 *                     + the problem is still inside its jurisdiction
 *   Organisation side ACTIVE membership of the assigned organisation
 *                     + the organisation is operational
 *
 * Anyone else — another organisation, another office, a citizen, a platform
 * administrator who is not a member — gets 404, exactly as for a room that
 * does not exist, so room ids cannot be probed.
 */
@Injectable()
export class ResolutionAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(roomId: string, user: RequestUser): Promise<RoomContext> {
    const room = await this.prisma.resolutionRoom.findUnique({
      where: { id: roomId },
      include: { governmentOrganization: true, assignedOrganization: true },
    });
    if (!room) throw AppException.notFound('Resolution room');

    const memberships = await this.prisma.organizationMember.findMany({
      where: {
        userId: user.id,
        status: 'ACTIVE',
        organizationId: {
          in: [room.governmentOrganizationId, room.assignedOrganizationId],
        },
      },
    });
    const government = memberships.find(
      (m) => m.organizationId === room.governmentOrganizationId,
    );
    const assigned = memberships.find(
      (m) => m.organizationId === room.assignedOrganizationId,
    );

    if (government && user.role === 'GOVERNMENT') {
      const office = room.governmentOrganization;
      if (office.deletedAt !== null || office.type !== 'GOVERNMENT') {
        throw AppException.notFound('Resolution room');
      }
      if (!OrganizationAccessService.isOperational(office)) {
        throw AppException.forbidden('Your office is suspended on Samadhaan.');
      }
      if (!(await this.inJurisdiction(office.id, room.problemId))) {
        throw AppException.notFound('Resolution room');
      }
      return { room, side: 'GOVERNMENT', organization: office, membership: government };
    }

    if (assigned) {
      const organization = room.assignedOrganization;
      if (organization.deletedAt !== null) throw AppException.notFound('Resolution room');
      if (!OrganizationAccessService.isOperational(organization)) {
        throw AppException.forbidden(
          'This organisation is suspended. Its workspace is closed until Samadhaan restores it.',
        );
      }
      await this.assertProblemVisible(room.problemId);
      return { room, side: 'ORGANIZATION', organization, membership: assigned };
    }

    throw AppException.notFound('Resolution room');
  }

  /** The office's jurisdiction still covers the problem, and it is not deleted. */
  private async inJurisdiction(officeId: string, problemId: string): Promise<boolean> {
    const jurisdiction = await resolveJurisdiction(this.prisma, officeId);
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT p.id FROM problems p
      WHERE p.id = ${problemId}::uuid AND p."deletedAt" IS NULL AND ${jurisdiction.condition}
    `);
    return rows.length > 0;
  }

  private async assertProblemVisible(problemId: string): Promise<void> {
    const problem = await this.prisma.problem.findFirst({
      where: { id: problemId, deletedAt: null },
      select: { id: true },
    });
    if (!problem) throw AppException.notFound('Resolution room');
  }
}
