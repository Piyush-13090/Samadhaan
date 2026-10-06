import { Injectable } from '@nestjs/common';
import type {
  MarkAllReadResult,
  NotificationFilter,
  NotificationPage,
  NotificationView,
} from '@samadhaan/shared';
import { AppException } from '../common/app.exception.js';
import { decodeIdCursor, encodeIdCursor } from '../common/id-cursor.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Notification } from '../generated/prisma/client.js';
import { channelsFor } from './notification-channels.js';
import { hrefFor, sanitizeMetadata } from './notification-metadata.js';
import type { NotificationDraft } from './notification-planner.js';

/** Bounds matching the table's CHECK constraints. */
const TITLE_MAX = 120;
const MESSAGE_MAX = 300;

/** Rows per insert. A popular problem's followers are written in batches. */
const INSERT_BATCH = 500;

/**
 * Stores and serves one person's notifications.
 *
 * **Every read and write is scoped by `recipientId`, which only ever comes from
 * the verified session.** Lookups by id are `WHERE id = ? AND recipientId = ?`,
 * so another person's notification id is indistinguishable from a missing one
 * — a 404 either way, never a 403 that would confirm it exists.
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  // ================================================================== write

  /**
   * Writes notifications, skipping any already written for the same event.
   *
   * `skipDuplicates` turns the `(recipientId, dedupeKey)` unique constraint
   * into idempotency: a replayed event, a retried job or two racing handlers
   * insert each notification once. Returns how many were actually new.
   */
  async createMany(drafts: NotificationDraft[]): Promise<number> {
    const rows = drafts
      .filter((draft) => channelsFor(draft.type).includes('IN_APP'))
      .map((draft) => ({
        recipientId: draft.recipientId,
        type: draft.type,
        title: draft.title.slice(0, TITLE_MAX),
        message: draft.message.slice(0, MESSAGE_MAX),
        entityType: draft.entityType,
        entityId: draft.entityId,
        // Re-validated on the way in, so nothing outside the allow-list is
        // ever stored, whoever built the draft.
        metadata: { ...sanitizeMetadata(draft.metadata) },
        dedupeKey: draft.dedupeKey.slice(0, 200),
      }));

    let created = 0;
    for (let start = 0; start < rows.length; start += INSERT_BATCH) {
      const { count } = await this.prisma.notification.createMany({
        data: rows.slice(start, start + INSERT_BATCH),
        skipDuplicates: true,
      });
      created += count;
    }

    return created;
  }

  // =================================================================== read

  /**
   * Newest first, keyset-paginated on `(createdAt, id)` — the composite index
   * answers it directly, and new notifications arriving mid-scroll do not
   * shift later pages.
   */
  async list(
    recipientId: string,
    query: { cursor?: string; limit: number; filter: NotificationFilter },
  ): Promise<NotificationPage> {
    const where = {
      recipientId,
      ...(query.filter === 'unread' ? { readAt: null } : {}),
    };

    const [rows, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
        ...(query.cursor
          ? { cursor: { id: decodeIdCursor(query.cursor) }, skip: 1 }
          : {}),
      }),
      this.unreadCount(recipientId),
    ]);

    const page = rows.slice(0, query.limit);
    const last = page.at(-1);

    return {
      items: page.map(toNotificationView),
      nextCursor: rows.length > query.limit && last ? encodeIdCursor(last.id) : null,
      unreadCount,
    };
  }

  /** One indexed count on `(recipientId, readAt)`. Polled by the bell. */
  unreadCount(recipientId: string): Promise<number> {
    return this.prisma.notification.count({ where: { recipientId, readAt: null } });
  }

  // ============================================================ read state

  /** Idempotent: marking a read notification read keeps its original `readAt`. */
  async markRead(recipientId: string, id: string): Promise<NotificationView> {
    await this.prisma.notification.updateMany({
      where: { id, recipientId, readAt: null },
      data: { readAt: new Date() },
    });

    const row = await this.prisma.notification.findFirst({ where: { id, recipientId } });
    if (!row) throw AppException.notFound('Notification');

    return toNotificationView(row);
  }

  async markAllRead(recipientId: string): Promise<MarkAllReadResult> {
    const { count } = await this.prisma.notification.updateMany({
      where: { recipientId, readAt: null },
      data: { readAt: new Date() },
    });

    return { updated: count, unreadCount: await this.unreadCount(recipientId) };
  }

  async remove(recipientId: string, id: string): Promise<{ unreadCount: number }> {
    const { count } = await this.prisma.notification.deleteMany({
      where: { id, recipientId },
    });
    if (count === 0) throw AppException.notFound('Notification');

    return { unreadCount: await this.unreadCount(recipientId) };
  }
}

/**
 * The only notification shape the API emits.
 *
 * Metadata is re-validated here rather than trusted because it was validated
 * on write: a JSON column outlives the code that wrote it. The link is derived,
 * never read from storage. `dedupeKey` and `recipientId` are internal and never
 * leave the server.
 */
export function toNotificationView(row: Notification): NotificationView {
  const metadata = sanitizeMetadata(row.metadata);

  return {
    id: row.id,
    type: row.type,
    title: row.title,
    message: row.message,
    entityType: row.entityType,
    href: hrefFor(row.type, metadata),
    problemPublicId: metadata.problemPublicId ?? null,
    isRead: row.readAt !== null,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
