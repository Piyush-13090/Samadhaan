'use client';

import {
  AlertTriangle,
  AtSign,
  CalendarClock,
  ClipboardList,
  Flag,
  Building2,
  CheckCircle2,
  Copy,
  Heart,
  Lock,
  MessagesSquare,
  MessageSquare,
  RefreshCw,
  Reply,
  Undo2,
  X,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import type { NotificationType, NotificationView } from '@samadhaan/shared';
import { AiSparkIcon } from '@/components/ai/ai-badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { formatDate, formatRelativeTime } from '@/lib/format';

/**
 * A small contextual icon per type. Decorative — the title always says what
 * happened, so meaning never rests on the glyph or its colour.
 */
const TYPE_META: Record<
  NotificationType,
  { icon: LucideIcon | typeof AiSparkIcon; className: string }
> = {
  AI_ANALYSIS_COMPLETED: { icon: AiSparkIcon, className: 'bg-ai-soft text-ai' },
  AI_ANALYSIS_FAILED: { icon: AlertTriangle, className: 'bg-warning-soft text-warning' },
  POSSIBLE_DUPLICATE_FOUND: { icon: Copy, className: 'bg-ai-soft text-ai' },
  PROBLEM_SUPPORTED: { icon: Heart, className: 'bg-danger-soft text-danger' },
  PROBLEM_COMMENTED: { icon: MessageSquare, className: 'bg-subtle text-ink-muted' },
  COMMENT_REPLIED: { icon: Reply, className: 'bg-subtle text-ink-muted' },
  FOLLOWED_PROBLEM_UPDATED: { icon: RefreshCw, className: 'bg-info-soft text-info' },
  PROBLEM_STATUS_CHANGED: { icon: RefreshCw, className: 'bg-info-soft text-info' },
  ALLOCATION_REQUESTED: { icon: Building2, className: 'bg-primary-soft text-primary' },
  ALLOCATION_ACCEPTED: { icon: CheckCircle2, className: 'bg-success-soft text-success' },
  ALLOCATION_DECLINED: { icon: XCircle, className: 'bg-warning-soft text-warning' },
  ALLOCATION_CANCELLED: { icon: Undo2, className: 'bg-subtle text-ink-muted' },
  RESOLUTION_MESSAGE: { icon: MessagesSquare, className: 'bg-primary-soft text-primary' },
  RESOLUTION_MENTION: { icon: AtSign, className: 'bg-primary-soft text-primary' },
  RESOLUTION_ROOM_CLOSED: { icon: Lock, className: 'bg-subtle text-ink-muted' },
  PROJECT_TASK_ASSIGNED: {
    icon: ClipboardList,
    className: 'bg-primary-soft text-primary',
  },
  PROJECT_TASK_DUE_SOON: {
    icon: CalendarClock,
    className: 'bg-warning-soft text-warning',
  },
  PROJECT_TASK_COMPLETED: {
    icon: CheckCircle2,
    className: 'bg-success-soft text-success',
  },
  PROJECT_MILESTONE_COMPLETED: { icon: Flag, className: 'bg-success-soft text-success' },
  PROJECT_STATUS_CHANGED: { icon: RefreshCw, className: 'bg-info-soft text-info' },
  PROJECT_COORDINATOR_ALERT: {
    icon: AlertTriangle,
    className: 'bg-warning-soft text-warning',
  },
  PROJECT_COORDINATOR_QUESTION: { icon: AiSparkIcon, className: 'bg-ai-soft text-ai' },
};

/**
 * One notification.
 *
 * The whole row is a link to `href`, which the API builds from validated data —
 * always an in-app path. Title and message are rendered as text nodes; they
 * contain user-chosen display names and are never treated as markup.
 *
 * Unread is shown three ways, so it survives greyscale and a screen reader: a
 * dot, a heavier title, and the word "Unread" in the accessible name. The
 * subtle background tint is a fourth, never the only one.
 */
export function NotificationItem({
  notification,
  onOpen,
  onDelete,
  compact = false,
  className,
}: {
  notification: NotificationView;
  /** Called as the link is followed — marks it read. */
  onOpen?: (notification: NotificationView) => void;
  /** Shows a dismiss control. The popover omits it to stay compact. */
  onDelete?: (notification: NotificationView) => void;
  compact?: boolean;
  className?: string;
}) {
  const meta = TYPE_META[notification.type];
  const Icon = meta.icon;
  const unread = !notification.isRead;

  return (
    <div
      className={cn(
        'group relative flex items-start gap-1 rounded-control transition-colors duration-fast',
        unread ? 'bg-primary-soft/40 hover:bg-primary-soft/70' : 'hover:bg-subtle',
        className,
      )}
    >
      <Link
        href={notification.href}
        onClick={() => onOpen?.(notification)}
        className={cn(
          'flex min-w-0 flex-1 items-start gap-3 rounded-control text-left',
          // Large enough to tap with a thumb.
          compact ? 'px-3 py-2.5' : 'min-h-14 px-3 py-3',
          'focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none',
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'grid size-8 shrink-0 place-items-center rounded-full',
            meta.className,
          )}
        >
          <Icon className="size-4" />
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex items-start gap-2">
            <span
              className={cn(
                'flex-1 type-body-sm text-ink',
                unread ? 'font-semibold' : 'font-normal',
              )}
            >
              {unread && (
                <>
                  <span className="sr-only">Unread:</span>{' '}
                </>
              )}
              {notification.title}
            </span>
            {unread && (
              <span
                aria-hidden="true"
                className="mt-1.5 size-2 shrink-0 rounded-full bg-primary"
              />
            )}
          </span>

          <span
            className={cn(
              'mt-0.5 block type-caption break-words text-ink-muted',
              compact && 'line-clamp-2',
            )}
          >
            {notification.message}
          </span>
          <time
            dateTime={notification.createdAt}
            title={formatDate(notification.createdAt)}
            className="mt-1 block type-caption text-ink-subtle"
          >
            {formatRelativeTime(notification.createdAt)}
          </time>
        </span>
      </Link>

      {onDelete && (
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          // Visible on hover and focus for pointer users; always present for
          // keyboard and touch, where hover does not exist.
          className="mt-2 mr-1 size-9 shrink-0 opacity-70 group-hover:opacity-100 focus-visible:opacity-100"
          aria-label={`Dismiss notification: ${notification.title}`}
          onClick={() => onDelete(notification)}
        >
          <X />
        </Button>
      )}
    </div>
  );
}

/** Row-shaped skeleton for the list and popover. */
export function NotificationItemSkeleton() {
  return (
    <div className="flex items-start gap-3 px-3 py-3" aria-hidden="true">
      <div className="size-8 shrink-0 animate-shimmer rounded-full bg-subtle" />
      <div className="flex-1 space-y-2">
        <div className="h-3.5 w-2/3 animate-shimmer rounded bg-subtle" />
        <div className="h-3 w-full animate-shimmer rounded bg-subtle" />
        <div className="h-3 w-16 animate-shimmer rounded bg-subtle" />
      </div>
    </div>
  );
}
