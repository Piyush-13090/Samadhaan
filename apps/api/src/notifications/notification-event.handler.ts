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

      default:
        return {};
    }
  }
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
