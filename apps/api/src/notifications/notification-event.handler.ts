import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { DomainEventBus } from '../events/domain-event-bus.js';
import type { DomainEvent } from '../events/domain-events.js';
import { planNotifications, type PlanningFacts } from './notification-planner.js';
import { NotificationsService } from './notifications.service.js';

/**
 * Domain event → notification.
 *
 *     Domain event ──▶ NotificationEventHandler ──▶ planNotifications ──▶ NotificationsService
 *     (after commit)   (resolves facts)             (who, and what words)  (idempotent insert)
 *
 * The only place notifications are created from. Controllers and domain
 * services publish facts and never mention notifications, so adding a channel
 * or changing a recipient rule touches this module alone.
 *
 * Runs off the request path (the bus dispatches after the publisher returns),
 * and a failure here is logged and dropped: a notification is a side effect,
 * and a civic action is never rolled back because one could not be written.
 */
@Injectable()
export class NotificationEventHandler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationEventHandler.name);
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly bus: DomainEventBus,
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit(): void {
    this.unsubscribe = this.bus.subscribe((event) => this.handle(event));
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
  }

  async handle(event: DomainEvent): Promise<void> {
    try {
      const facts = await this.factsFor(event);
      const drafts = planNotifications(event, facts);
      if (drafts.length === 0) return;

      const created = await this.notifications.createMany(drafts);
      this.logger.debug(`${event.type}: ${created} notification(s) created`);
    } catch (error) {
      this.logger.error(
        `Could not create notifications for ${event.type}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }

  /** Looks up only what the planner needs for this kind of event. */
  private async factsFor(event: DomainEvent): Promise<PlanningFacts> {
    switch (event.type) {
      case 'COMMENT_CREATED':
      case 'COMMENT_REPLIED': {
        const actor = await this.prisma.user.findUnique({
          where: { id: event.actorUserId },
          select: { displayName: true, fullName: true, deletedAt: true },
        });
        // The same public name the comment itself shows.
        const actorName =
          actor && !actor.deletedAt ? (actor.displayName ?? actor.fullName) : undefined;
        return { actorName };
      }

      case 'PROBLEM_STATUS_CHANGED': {
        const follows = await this.prisma.problemFollow.findMany({
          where: { problemId: event.problemId, user: { deletedAt: null } },
          select: { userId: true },
        });
        return { followerIds: follows.map((follow) => follow.userId) };
      }

      // A request or a withdrawal goes to the people who can act on it — the
      // organisation's owners and admins. A response goes to the officials of
      // the office that asked. Current, active memberships only.
      case 'ALLOCATION_CREATED':
      case 'ALLOCATION_CANCELLED': {
        const managers = await this.prisma.organizationMember.findMany({
          where: {
            organizationId: event.organizationId,
            status: 'ACTIVE',
            membershipRole: { in: ['OWNER', 'ADMIN'] },
            user: { deletedAt: null },
          },
          select: { userId: true },
        });
        return { allocationRecipientIds: managers.map((member) => member.userId) };
      }
      case 'ALLOCATION_ACCEPTED':
      case 'ALLOCATION_DECLINED': {
        const officials = await this.prisma.organizationMember.findMany({
          where: {
            organizationId: event.governmentOrganizationId,
            status: 'ACTIVE',
            user: { deletedAt: null, role: 'GOVERNMENT' },
          },
          select: { userId: true },
        });
        return { allocationRecipientIds: officials.map((member) => member.userId) };
      }

      case 'RESOLUTION_MESSAGE_POSTED':
      case 'RESOLUTION_ROOM_CLOSED':
      case 'PROJECT_MILESTONE_COMPLETED':
      case 'PROJECT_STATUS_CHANGED':
        return {
          roomParticipants: await roomParticipantFacts(this.prisma, event.roomId),
        };

      case 'COORDINATOR_ALERT':
      case 'COORDINATOR_QUESTIONS_ASKED':
        return {
          coordinatorRecipientIds: await coordinatorRecipientFacts(
            this.prisma,
            event.projectId,
            event.type === 'COORDINATOR_QUESTIONS_ASKED' ? event.assigneeIds : [],
          ),
        };

      case 'EVIDENCE_SUBMITTED':
      case 'EVIDENCE_REVIEWED':
        return {
          officialIds: await officialFacts(this.prisma, event.governmentOrganizationId),
        };
      case 'VERIFICATION_REQUESTED':
        return {
          officialIds: await officialFacts(this.prisma, event.governmentOrganizationId),
          organizationManagerIds: await managerFacts(this.prisma, event.organizationId),
        };
      case 'VERIFICATION_DECIDED':
        return {
          organizationManagerIds: await managerFacts(this.prisma, event.organizationId),
        };

      case 'PRIORITY_TIER_CHANGED': {
        if (event.toTier !== 'CRITICAL') return {};
        const [recipients, override] = await Promise.all([
          escalationRecipientFacts(this.prisma, event.problemId),
          this.prisma.problemPriorityOverride.findUnique({
            where: { problemId: event.problemId },
            select: { id: true },
          }),
        ]);
        return { escalationRecipients: recipients, overridden: override !== null };
      }

      default:
        return {};
    }
  }
}

/**
 * Officials of every operational government office whose jurisdiction covers
 * the problem — the same rule `resolveJurisdiction` applies (a boundary, else
 * cities, else postal codes), evaluated for all offices in one query. A user in
 * several such offices is notified once, linked to the first.
 */
export async function escalationRecipientFacts(
  prisma: PrismaService,
  problemId: string,
): Promise<Array<{ userId: string; governmentSlug: string }>> {
  const rows = await prisma.$queryRaw<Array<{ userId: string; slug: string }>>`
    SELECT DISTINCT ON (m."userId") m."userId", o.slug
    FROM problems p
    JOIN organizations o ON o.type = 'GOVERNMENT' AND o."deletedAt" IS NULL
      AND o."isActive" AND o."verificationStatus" <> 'SUSPENDED'
    JOIN organization_members m ON m."organizationId" = o.id AND m.status = 'ACTIVE'
    JOIN users u ON u.id = m."userId" AND u.role = 'GOVERNMENT' AND u."deletedAt" IS NULL
    WHERE p.id = ${problemId}::uuid
      AND (
        (o."jurisdictionBoundary" IS NOT NULL AND ST_Covers(o."jurisdictionBoundary", p.location))
        OR (o."jurisdictionBoundary" IS NULL AND cardinality(o."jurisdictionCities") > 0
            AND lower(p.city) IN (SELECT lower(btrim(c)) FROM unnest(o."jurisdictionCities") c))
        OR (o."jurisdictionBoundary" IS NULL AND cardinality(o."jurisdictionCities") = 0
            AND upper(p."postalCode") IN (SELECT upper(btrim(c)) FROM unnest(o."jurisdictionPostalCodes") c))
      )
    ORDER BY m."userId", o.slug
  `;
  return rows.map((r) => ({ userId: r.userId, governmentSlug: r.slug }));
}

/**
 * A room's current participants and their read markers. The same rule as
 * room access: ACTIVE members of the assigned organisation, and ACTIVE
 * members of the allocating office whose platform role is GOVERNMENT.
 */
async function roomParticipantFacts(
  prisma: PrismaService,
  roomId: string,
): Promise<Array<{ userId: string; lastReadAt: string | null }>> {
  const room = await prisma.resolutionRoom.findUnique({
    where: { id: roomId },
    select: { governmentOrganizationId: true, assignedOrganizationId: true },
  });
  if (!room) return [];
  const [members, reads] = await Promise.all([
    prisma.organizationMember.findMany({
      where: {
        status: 'ACTIVE',
        user: { deletedAt: null },
        OR: [
          { organizationId: room.assignedOrganizationId },
          { organizationId: room.governmentOrganizationId, user: { role: 'GOVERNMENT' } },
        ],
      },
      select: { userId: true },
    }),
    prisma.resolutionRoomRead.findMany({
      where: { roomId },
      select: { userId: true, lastReadAt: true },
    }),
  ]);
  const readBy = new Map(reads.map((read) => [read.userId, read.lastReadAt]));
  const ids = [...new Set(members.map((member) => member.userId))];
  return ids.map((userId) => ({
    userId,
    lastReadAt: readBy.get(userId)?.toISOString() ?? null,
  }));
}

/**
 * A project's coordinators: the assigned organisation's active OWNER/ADMIN,
 * the allocating office's active officials, and any of the given assignees who
 * are still active members of the assigned organisation.
 */
async function coordinatorRecipientFacts(
  prisma: PrismaService,
  projectId: string,
  assigneeIds: string[],
): Promise<string[]> {
  const project = await prisma.resolutionProject.findUnique({
    where: { id: projectId },
    select: { assignedOrganizationId: true, governmentOrganizationId: true },
  });
  if (!project) return [];
  const members = await prisma.organizationMember.findMany({
    where: {
      status: 'ACTIVE',
      user: { deletedAt: null },
      OR: [
        {
          organizationId: project.assignedOrganizationId,
          membershipRole: { in: ['OWNER', 'ADMIN'] },
        },
        { organizationId: project.assignedOrganizationId, userId: { in: assigneeIds } },
        {
          organizationId: project.governmentOrganizationId,
          user: { role: 'GOVERNMENT' },
        },
      ],
    },
    select: { userId: true },
  });
  return [...new Set(members.map((member) => member.userId))];
}

/** Active officials of a government office (role GOVERNMENT). */
async function officialFacts(
  prisma: PrismaService,
  organizationId: string,
): Promise<string[]> {
  const rows = await prisma.organizationMember.findMany({
    where: {
      organizationId,
      status: 'ACTIVE',
      user: { deletedAt: null, role: 'GOVERNMENT' },
    },
    select: { userId: true },
  });
  return rows.map((r) => r.userId);
}

/** An organisation's active OWNER/ADMIN members. */
async function managerFacts(
  prisma: PrismaService,
  organizationId: string,
): Promise<string[]> {
  const rows = await prisma.organizationMember.findMany({
    where: {
      organizationId,
      status: 'ACTIVE',
      membershipRole: { in: ['OWNER', 'ADMIN'] },
      user: { deletedAt: null },
    },
    select: { userId: true },
  });
  return rows.map((r) => r.userId);
}
