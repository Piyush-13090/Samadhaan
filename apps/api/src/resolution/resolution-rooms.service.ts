import { Injectable } from '@nestjs/common';
import {
  RESOLUTION_MAX_ATTACHMENTS_PER_MESSAGE,
  RESOLUTION_MAX_MENTIONS,
  type ResolutionActivityEntry,
  type ResolutionActivityKind,
  type ResolutionAttachmentView,
  type ResolutionMessagePage,
  type ResolutionMessageView,
  type ResolutionParticipant,
  type ResolutionParticipants,
  type ResolutionRoomSummary,
  type ResolutionRoomView,
} from '@samadhaan/shared';
import type { RequestUser } from '../auth/auth.types.js';
import { AppException } from '../common/app.exception.js';
import { PrismaService } from '../database/prisma.service.js';
import { DomainEventBus } from '../events/domain-event-bus.js';
import { Prisma, type Organization } from '../generated/prisma/client.js';
import { StorageService } from '../storage/storage.types.js';
import type { RoomContext } from './resolution-access.service.js';
import { ResolutionRealtimeService } from './resolution-realtime.service.js';

const MESSAGE_INCLUDE = {
  author: { select: { id: true, fullName: true, avatarUrl: true } },
  authorOrganization: { select: { name: true } },
  mentions: { include: { user: { select: { id: true, fullName: true } } } },
  attachments: {
    include: { uploadedBy: { select: { id: true, fullName: true } } },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.ResolutionMessageInclude;

const ROOM_EVENT_TYPES = [
  'ROOM_CREATED',
  'PARTICIPANT_JOINED',
  'MESSAGE_SENT',
  'MESSAGE_EDITED',
  'MESSAGE_DELETED',
  'ATTACHMENT_ADDED',
  'ROOM_CLOSED',
] as const;

type MessageRow = Prisma.ResolutionMessageGetPayload<{ include: typeof MESSAGE_INCLUDE }>;

/**
 * Resolution rooms (Prompt 17): the room view, participants, messages,
 * activity, read markers and closure.
 *
 * Every method takes a `RoomContext` proven by `ResolutionAccessService` — the
 * caller's side and organisation come from there, never from the request
 * body. Messages are plain text; nothing here produces or accepts markup.
 */
@Injectable()
export class ResolutionRoomsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly events: DomainEventBus,
    private readonly realtime: ResolutionRealtimeService,
  ) {}

  // ================================================================== room

  async view(context: RoomContext, user: RequestUser): Promise<ResolutionRoomView> {
    const { room } = context;
    await this.recordJoin(context, user);

    const [problem, allocation, read] = await Promise.all([
      this.prisma.problem.findUniqueOrThrow({
        where: { id: room.problemId },
        include: {
          images: { orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }], take: 1 },
          aiAnalyses: {
            where: { analysisType: 'INITIAL_ANALYSIS', processingStatus: 'COMPLETED' },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      }),
      this.prisma.problemAllocation.findUniqueOrThrow({
        where: { id: room.allocationId },
      }),
      this.prisma.resolutionRoomRead.findUnique({
        where: { roomId_userId: { roomId: room.id, userId: user.id } },
      }),
    ]);

    const image = problem.images[0];
    const analysis = problem.aiAnalyses[0];
    const lastReadAt = read?.lastReadAt ?? null;

    return {
      id: room.id,
      status: room.status,
      createdAt: room.createdAt.toISOString(),
      closedAt: room.closedAt?.toISOString() ?? null,
      closeReason: room.closeReason,
      problem: {
        publicId: problem.publicId,
        title: problem.title,
        description: problem.description,
        status: problem.status,
        severity: problem.severity,
        category: problem.category,
        subcategory: problem.subcategory,
        address: problem.address,
        city: problem.city,
        state: problem.state,
        latitude: Number(problem.latitude),
        longitude: Number(problem.longitude),
        reportedAt: problem.createdAt.toISOString(),
        imageUrl: image ? await this.storage.getUrl(image.storageKey) : null,
        analysis: analysis
          ? {
              summary: analysis.summary,
              severity: analysis.severity,
              category: analysis.category,
              subcategory: analysis.subcategory,
            }
          : null,
      },
      government: orgRef(room.governmentOrganization),
      organization: orgRef(room.assignedOrganization),
      allocation: {
        id: allocation.id,
        proposedAt: allocation.proposedAt.toISOString(),
        acceptedAt: allocation.acceptedAt?.toISOString() ?? null,
        instructions: allocation.instructions,
      },
      viewer: {
        userId: user.id,
        side: context.side,
        canPost: room.status === 'OPEN',
        canClose: context.side === 'GOVERNMENT' && room.status === 'OPEN',
        homePath:
          context.side === 'GOVERNMENT'
            ? `/government/${room.governmentOrganization.slug}/problems/${problem.publicId}#allocation`
            : `/organization/${room.assignedOrganization.slug}/allocations/${room.allocationId}`,
      },
      unreadCount: await this.unreadCount(room.id, user.id, lastReadAt),
      lastReadAt: lastReadAt?.toISOString() ?? null,
    };
  }

  /** Rooms the caller participates in, through any of their memberships. */
  async mine(user: RequestUser): Promise<ResolutionRoomSummary[]> {
    const memberships = await this.prisma.organizationMember.findMany({
      where: { userId: user.id, status: 'ACTIVE', organization: { deletedAt: null } },
      select: { organizationId: true, organization: { select: { type: true } } },
    });
    const officeIds =
      user.role === 'GOVERNMENT'
        ? memberships
            .filter((m) => m.organization.type === 'GOVERNMENT')
            .map((m) => m.organizationId)
        : [];
    const orgIds = memberships
      .filter((m) => m.organization.type !== 'GOVERNMENT')
      .map((m) => m.organizationId);
    if (officeIds.length === 0 && orgIds.length === 0) return [];

    const rooms = await this.prisma.resolutionRoom.findMany({
      where: {
        problem: { deletedAt: null },
        OR: [
          { governmentOrganizationId: { in: officeIds } },
          { assignedOrganizationId: { in: orgIds } },
        ],
      },
      include: {
        problem: {
          select: { publicId: true, title: true, status: true, severity: true },
        },
        governmentOrganization: { select: { name: true } },
        assignedOrganization: { select: { name: true } },
        reads: { where: { userId: user.id }, select: { lastReadAt: true } },
        messages: {
          where: { deletedAt: null },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 1,
          select: { createdAt: true },
        },
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: 100,
    });

    // Jurisdiction is re-checked on entry (ResolutionAccessService); the list
    // shows only what membership already proves.
    return Promise.all(
      rooms.map(async (room) => {
        const lastReadAt = room.reads[0]?.lastReadAt ?? null;
        return {
          id: room.id,
          status: room.status,
          problem: room.problem,
          government: room.governmentOrganization,
          organization: room.assignedOrganization,
          side: officeIds.includes(room.governmentOrganizationId)
            ? 'GOVERNMENT'
            : 'ORGANIZATION',
          createdAt: room.createdAt.toISOString(),
          lastMessageAt: room.messages[0]?.createdAt.toISOString() ?? null,
          unreadCount: await this.unreadCount(room.id, user.id, lastReadAt),
        } satisfies ResolutionRoomSummary;
      }),
    );
  }

  async participants(context: RoomContext): Promise<ResolutionParticipants> {
    const { room } = context;
    const [members, reads] = await Promise.all([
      this.prisma.organizationMember.findMany({
        where: {
          status: 'ACTIVE',
          user: { deletedAt: null },
          OR: [
            { organizationId: room.assignedOrganizationId },
            {
              organizationId: room.governmentOrganizationId,
              user: { role: 'GOVERNMENT' },
            },
          ],
        },
        // Name, avatar and role only — no email, phone or profile details.
        select: {
          organizationId: true,
          membershipRole: true,
          user: { select: { id: true, fullName: true, avatarUrl: true } },
        },
        orderBy: [{ membershipRole: 'asc' }, { user: { fullName: 'asc' } }],
      }),
      this.prisma.resolutionRoomRead.findMany({
        where: { roomId: room.id },
        select: { userId: true },
      }),
    ]);
    const joined = new Set(reads.map((read) => read.userId));
    const toParticipant = (
      member: (typeof members)[number],
      side: ResolutionParticipant['side'],
    ): ResolutionParticipant => ({
      userId: member.user.id,
      name: member.user.fullName,
      avatarUrl: member.user.avatarUrl,
      membershipRole: member.membershipRole,
      side,
      joined: joined.has(member.user.id),
    });

    return {
      government: {
        name: room.governmentOrganization.name,
        members: members
          .filter((m) => m.organizationId === room.governmentOrganizationId)
          .map((m) => toParticipant(m, 'GOVERNMENT')),
      },
      organization: {
        name: room.assignedOrganization.name,
        members: members
          .filter((m) => m.organizationId === room.assignedOrganizationId)
          .map((m) => toParticipant(m, 'ORGANIZATION')),
      },
    };
  }

  /** The allocating office closes the room. Messages stay readable. */
  async close(context: RoomContext, reason: string, user: RequestUser): Promise<void> {
    if (context.side !== 'GOVERNMENT') {
      throw AppException.forbidden(
        'Only the allocating government office can close this room.',
      );
    }
    const closedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.resolutionRoom.updateMany({
        where: { id: context.room.id, status: 'OPEN' },
        data: { status: 'CLOSED', closedAt, closedById: user.id, closeReason: reason },
      });
      if (count === 0) throw AppException.conflict('This room is already closed.');

      await tx.resolutionRoomEvent.create({
        data: {
          roomId: context.room.id,
          type: 'ROOM_CLOSED',
          actorId: user.id,
          metadata: { organizationName: context.organization.name, reason },
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          action: 'RESOLUTION_ROOM_CLOSED',
          entityType: 'ResolutionRoom',
          entityId: context.room.id,
          metadata: { organizationId: context.organization.id, reason },
        },
      });
    });

    const problem = await this.problemRef(context.room.problemId);
    this.events.publish({
      type: 'RESOLUTION_ROOM_CLOSED',
      roomId: context.room.id,
      problemPublicId: problem.publicId,
      governmentName: context.organization.name,
      actorUserId: user.id,
    });
    this.realtime.publish(context.room.id, {
      type: 'room.closed',
      closedAt: closedAt.toISOString(),
      closeReason: reason,
    });
    await this.broadcastLatestActivity(context.room.id);
  }

  // ============================================================== messages

  /**
   * A page of messages, newest page first; oldest first within the page.
   * Keyset on (createdAt, id) — deterministic even for equal timestamps, and
   * stable while new messages arrive.
   */
  async messages(
    context: RoomContext,
    cursor: string | undefined,
    limit: number,
  ): Promise<ResolutionMessagePage> {
    const after = cursor ? decodeMessageCursor(cursor) : null;
    const rows = await this.prisma.resolutionMessage.findMany({
      where: {
        roomId: context.room.id,
        ...(after
          ? {
              OR: [
                { createdAt: { lt: after.createdAt } },
                { createdAt: after.createdAt, id: { lt: after.id } },
              ],
            }
          : {}),
      },
      include: MESSAGE_INCLUDE,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.reverse().map((row) => toMessageView(row, context.room.id)),
      nextCursor:
        rows.length > limit && last ? encodeMessageCursor(last.createdAt, last.id) : null,
    };
  }

  async post(
    context: RoomContext,
    input: { body: string; mentionUserIds: string[]; attachmentIds: string[] },
    user: RequestUser,
  ): Promise<ResolutionMessageView> {
    this.assertOpen(context);
    const body = cleanBody(input.body);
    const mentionIds = await this.validMentions(context, input.mentionUserIds, user.id);
    const attachmentIds = [...new Set(input.attachmentIds)].slice(
      0,
      RESOLUTION_MAX_ATTACHMENTS_PER_MESSAGE,
    );

    const message = await this.prisma.$transaction(async (tx) => {
      const created = await tx.resolutionMessage.create({
        data: {
          roomId: context.room.id,
          authorId: user.id,
          authorOrganizationId: context.organization.id,
          authorSide: context.side,
          body,
          mentions: { create: mentionIds.map((userId) => ({ userId })) },
        },
        select: { id: true },
      });

      if (attachmentIds.length > 0) {
        // Only the sender's own, not-yet-attached uploads to this room.
        const { count } = await tx.resolutionAttachment.updateMany({
          where: {
            id: { in: attachmentIds },
            roomId: context.room.id,
            uploadedById: user.id,
            messageId: null,
          },
          data: { messageId: created.id },
        });
        if (count !== attachmentIds.length) {
          throw AppException.badRequest('One of those attachments cannot be used.');
        }
      }

      await tx.resolutionRoomEvent.create({
        data: {
          roomId: context.room.id,
          type: 'MESSAGE_SENT',
          actorId: user.id,
          metadata: {
            messageId: created.id,
            organizationName: context.organization.name,
          },
        },
      });
      // Writing marks everything up to now as read for the author.
      await tx.resolutionRoomRead.upsert({
        where: { roomId_userId: { roomId: context.room.id, userId: user.id } },
        create: { roomId: context.room.id, userId: user.id, lastReadAt: new Date() },
        update: { lastReadAt: new Date() },
      });

      return tx.resolutionMessage.findUniqueOrThrow({
        where: { id: created.id },
        include: MESSAGE_INCLUDE,
      });
    });

    const view = toMessageView(message, context.room.id);
    const problem = await this.problemRef(context.room.problemId);
    this.events.publish({
      type: 'RESOLUTION_MESSAGE_POSTED',
      roomId: context.room.id,
      messageId: message.id,
      problemPublicId: problem.publicId,
      authorUserId: user.id,
      authorName: message.author.fullName,
      authorOrganizationName: context.organization.name,
      mentionedUserIds: mentionIds,
    });
    this.realtime.publish(context.room.id, { type: 'message.created', message: view });
    await this.broadcastLatestActivity(context.room.id);
    return view;
  }

  async edit(
    context: RoomContext,
    messageId: string,
    rawBody: string,
    user: RequestUser,
  ): Promise<ResolutionMessageView> {
    this.assertOpen(context);
    const body = cleanBody(rawBody);
    const updated = await this.prisma.$transaction(async (tx) => {
      // Own, live messages only. Another participant's message — whichever
      // side they are on — is answered as if it did not exist.
      const { count } = await tx.resolutionMessage.updateMany({
        where: {
          id: messageId,
          roomId: context.room.id,
          authorId: user.id,
          deletedAt: null,
        },
        data: { body, editedAt: new Date() },
      });
      if (count === 0) throw await this.messageRefusal(tx, context.room.id, messageId);

      await tx.resolutionRoomEvent.create({
        data: {
          roomId: context.room.id,
          type: 'MESSAGE_EDITED',
          actorId: user.id,
          metadata: { messageId, organizationName: context.organization.name },
        },
      });
      return tx.resolutionMessage.findUniqueOrThrow({
        where: { id: messageId },
        include: MESSAGE_INCLUDE,
      });
    });

    const view = toMessageView(updated, context.room.id);
    this.realtime.publish(context.room.id, { type: 'message.updated', message: view });
    return view;
  }

  /** Soft delete: the row and its text stay, for the record; nobody sees them. */
  async remove(
    context: RoomContext,
    messageId: string,
    user: RequestUser,
  ): Promise<void> {
    this.assertOpen(context);
    const updated = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.resolutionMessage.updateMany({
        where: {
          id: messageId,
          roomId: context.room.id,
          authorId: user.id,
          deletedAt: null,
        },
        data: { deletedAt: new Date() },
      });
      if (count === 0) throw await this.messageRefusal(tx, context.room.id, messageId);

      await tx.resolutionRoomEvent.create({
        data: {
          roomId: context.room.id,
          type: 'MESSAGE_DELETED',
          actorId: user.id,
          metadata: { messageId, organizationName: context.organization.name },
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          action: 'RESOLUTION_MESSAGE_DELETED',
          entityType: 'ResolutionRoom',
          entityId: context.room.id,
          metadata: { messageId },
        },
      });
      return tx.resolutionMessage.findUniqueOrThrow({
        where: { id: messageId },
        include: MESSAGE_INCLUDE,
      });
    });

    this.realtime.publish(context.room.id, {
      type: 'message.updated',
      message: toMessageView(updated, context.room.id),
    });
  }

  /** Marks everything up to now as read for the caller. */
  async markRead(
    context: RoomContext,
    user: RequestUser,
  ): Promise<{ unreadCount: number }> {
    const now = new Date();
    await this.prisma.resolutionRoomRead.upsert({
      where: { roomId_userId: { roomId: context.room.id, userId: user.id } },
      create: { roomId: context.room.id, userId: user.id, lastReadAt: now },
      update: { lastReadAt: now },
    });
    return { unreadCount: await this.unreadCount(context.room.id, user.id, now) };
  }

  // ============================================================== activity

  /**
   * The room's timeline: the allocation and acceptance (from the allocation
   * itself) and the room's own system events. Never message text.
   */
  async activity(context: RoomContext): Promise<ResolutionActivityEntry[]> {
    const { room } = context;
    const [allocation, events] = await Promise.all([
      this.prisma.problemAllocation.findUniqueOrThrow({
        where: { id: room.allocationId },
        include: {
          allocatedBy: { select: { fullName: true } },
          respondedBy: { select: { fullName: true } },
        },
      }),
      this.prisma.resolutionRoomEvent.findMany({
        // The room's own events. Project events have the project's timeline.
        where: { roomId: room.id, type: { in: [...ROOM_EVENT_TYPES] } },
        include: { actor: { select: { fullName: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 100,
      }),
    ]);

    const entries: ResolutionActivityEntry[] = [
      {
        id: `${allocation.id}:allocated`,
        kind: 'ALLOCATED',
        actor: {
          name: allocation.allocatedBy.fullName,
          organizationName: room.governmentOrganization.name,
        },
        organizationName: room.assignedOrganization.name,
        fileName: null,
        reason: null,
        createdAt: allocation.proposedAt.toISOString(),
      },
    ];
    if (allocation.acceptedAt) {
      entries.push({
        id: `${allocation.id}:accepted`,
        kind: 'ACCEPTED',
        actor: allocation.respondedBy
          ? {
              name: allocation.respondedBy.fullName,
              organizationName: room.assignedOrganization.name,
            }
          : null,
        organizationName: room.assignedOrganization.name,
        fileName: null,
        reason: null,
        createdAt: allocation.acceptedAt.toISOString(),
      });
    }
    entries.push(...events.reverse().map(toActivityEntry));
    return entries;
  }

  // =============================================================== helpers

  private assertOpen(context: RoomContext): void {
    if (context.room.status !== 'OPEN') {
      throw AppException.conflict('This room is closed. Its messages remain readable.');
    }
  }

  /** First visit: a read row and a PARTICIPANT_JOINED event, once. */
  private async recordJoin(context: RoomContext, user: RequestUser): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.resolutionRoomRead.create({
          data: { roomId: context.room.id, userId: user.id },
        });
        await tx.resolutionRoomEvent.create({
          data: {
            roomId: context.room.id,
            type: 'PARTICIPANT_JOINED',
            actorId: user.id,
            metadata: { organizationName: context.organization.name },
          },
        });
      });
    } catch (error) {
      // Already joined (or a concurrent first visit won) — nothing to record.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        return;
      throw error;
    }
    await this.broadcastLatestActivity(context.room.id);
  }

  private async unreadCount(
    roomId: string,
    userId: string,
    lastReadAt: Date | null,
  ): Promise<number> {
    return this.prisma.resolutionMessage.count({
      where: {
        roomId,
        deletedAt: null,
        authorId: { not: userId },
        ...(lastReadAt ? { createdAt: { gt: lastReadAt } } : {}),
      },
    });
  }

  /** Mentions must name current participants; anyone else is dropped. */
  private async validMentions(
    context: RoomContext,
    requested: string[],
    authorId: string,
  ): Promise<string[]> {
    const ids = [...new Set(requested)]
      .filter((id) => id !== authorId)
      .slice(0, RESOLUTION_MAX_MENTIONS);
    if (ids.length === 0) return [];
    const { room } = context;
    const members = await this.prisma.organizationMember.findMany({
      where: {
        userId: { in: ids },
        status: 'ACTIVE',
        user: { deletedAt: null },
        OR: [
          { organizationId: room.assignedOrganizationId },
          { organizationId: room.governmentOrganizationId, user: { role: 'GOVERNMENT' } },
        ],
      },
      select: { userId: true },
    });
    return [...new Set(members.map((member) => member.userId))];
  }

  /** 404 if the message is not in this room; 403 if it is someone else's. */
  private async messageRefusal(
    tx: Prisma.TransactionClient,
    roomId: string,
    messageId: string,
  ): Promise<AppException> {
    const message = await tx.resolutionMessage.findFirst({
      where: { id: messageId, roomId },
      select: { deletedAt: true },
    });
    if (!message) return AppException.notFound('Message');
    if (message.deletedAt) return AppException.conflict('That message was deleted.');
    return AppException.forbidden('You can only change your own messages.');
  }

  private async problemRef(problemId: string): Promise<{ publicId: string }> {
    return this.prisma.problem.findUniqueOrThrow({
      where: { id: problemId },
      select: { publicId: true },
    });
  }

  private async broadcastLatestActivity(roomId: string): Promise<void> {
    const event = await this.prisma.resolutionRoomEvent.findFirst({
      where: { roomId, type: { in: [...ROOM_EVENT_TYPES] } },
      include: { actor: { select: { fullName: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    if (event)
      this.realtime.publish(roomId, { type: 'activity', entry: toActivityEntry(event) });
  }
}

// ---------------------------------------------------------------- helpers

function orgRef(organization: Organization): ResolutionRoomView['government'] {
  return {
    slug: organization.slug,
    name: organization.name,
    type: organization.type as ResolutionRoomView['government']['type'],
    logoUrl: organization.logoUrl,
  };
}

/**
 * Plain text, trimmed, with control characters other than newlines and tabs
 * removed. Not HTML-escaped here — the web renders messages as text nodes, so
 * markup is inert wherever it appears.
 */
export function cleanBody(raw: string): string {
  // eslint-disable-next-line no-control-regex
  const body = raw.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  if (body.length === 0) throw AppException.badRequest('Write a message first.');
  return body;
}

export function encodeMessageCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`, 'utf8').toString('base64url');
}

export function decodeMessageCursor(cursor: string): { createdAt: Date; id: string } {
  const [iso, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const createdAt = iso ? new Date(iso) : null;
  if (
    !createdAt ||
    Number.isNaN(createdAt.getTime()) ||
    !id ||
    !/^[0-9a-f-]{36}$/i.test(id)
  ) {
    throw AppException.badRequest('That page cursor is not valid.');
  }
  return { createdAt, id };
}

export function attachmentUrl(roomId: string, attachmentId: string): string {
  return `/api/v1/resolution-rooms/${roomId}/attachments/${attachmentId}/file`;
}

export function toAttachmentView(
  attachment: MessageRow['attachments'][number],
  roomId: string,
): ResolutionAttachmentView {
  return {
    id: attachment.id,
    fileName: attachment.fileName,
    mimeType: attachment.mimeType,
    size: attachment.size,
    url: attachmentUrl(roomId, attachment.id),
    uploadedBy: {
      userId: attachment.uploadedBy.id,
      name: attachment.uploadedBy.fullName,
    },
    messageId: attachment.messageId,
    createdAt: attachment.createdAt.toISOString(),
  };
}

function toMessageView(row: MessageRow, roomId: string): ResolutionMessageView {
  const deleted = row.deletedAt !== null;
  return {
    id: row.id,
    // A deleted message keeps its row; its content never leaves the server.
    body: deleted ? null : row.body,
    author: {
      userId: row.author.id,
      name: row.author.fullName,
      avatarUrl: row.author.avatarUrl,
      organizationName: row.authorOrganization.name,
      side: row.authorSide,
    },
    mentions: deleted
      ? []
      : row.mentions.map((m) => ({ userId: m.user.id, name: m.user.fullName })),
    attachments: deleted ? [] : row.attachments.map((a) => toAttachmentView(a, roomId)),
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt?.toISOString() ?? null,
    deletedAt: row.deletedAt?.toISOString() ?? null,
  };
}

function toActivityEntry(
  event: Prisma.ResolutionRoomEventGetPayload<{
    include: { actor: { select: { fullName: true } } };
  }>,
): ResolutionActivityEntry {
  const metadata = (event.metadata ?? {}) as Record<string, unknown>;
  const text = (key: string) =>
    typeof metadata[key] === 'string' ? (metadata[key] as string) : null;
  return {
    id: event.id,
    kind: event.type as ResolutionActivityKind,
    actor: event.actor
      ? { name: event.actor.fullName, organizationName: text('organizationName') }
      : null,
    organizationName: text('organizationName'),
    fileName: text('fileName'),
    reason: event.type === 'ROOM_CLOSED' ? text('reason') : null,
    createdAt: event.createdAt.toISOString(),
  };
}
