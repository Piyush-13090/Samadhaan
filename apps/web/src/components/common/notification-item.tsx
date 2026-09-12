import {
  Building2,
  CheckCircle2,
  Lightbulb,
  MessageSquare,
  RefreshCw,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/cn';
import { formatRelativeTime } from '@/lib/format';
import type { NotificationKind, NotificationSummary } from '@/types/domain';
import { AiSparkIcon } from '@/components/ai/ai-badge';

const KIND_META: Record<
  NotificationKind,
  { icon: LucideIcon | typeof AiSparkIcon; className: string }
> = {
  PROBLEM_UPDATE: { icon: RefreshCw, className: 'bg-info-soft text-info' },
  AI_ANALYSIS: { icon: AiSparkIcon, className: 'bg-ai-soft text-ai' },
  COMMENT: { icon: MessageSquare, className: 'bg-subtle text-ink-muted' },
  SUGGESTION: { icon: Lightbulb, className: 'bg-warning-soft text-warning' },
  ALLOCATION: { icon: Building2, className: 'bg-primary-soft text-primary' },
  RESOLUTION: { icon: CheckCircle2, className: 'bg-success-soft text-success' },
};

/**
 * One notification.
 *
 * Unread state is carried by a dot and a weight change, not by background
 * colour alone — a tinted row is easy to miss and impossible to distinguish
 * for some users.
 */
export function NotificationItem({
  notification,
  className,
}: {
  notification: NotificationSummary;
  className?: string;
}) {
  const meta = KIND_META[notification.kind];
  const Icon = meta.icon;

  const body = (
    <>
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
              !notification.read && 'font-semibold',
            )}
          >
            {notification.title}
          </span>
          {!notification.read && (
            <>
              <span
                aria-hidden="true"
                className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary"
              />
              <span className="sr-only">Unread</span>
            </>
          )}
        </span>

        <span className="mt-0.5 block type-caption text-ink-muted">
          {notification.body}
        </span>
        <span className="mt-1 block type-caption text-ink-subtle">
          {formatRelativeTime(notification.createdAt)}
        </span>
      </span>
    </>
  );

  const baseClasses = cn(
    'flex w-full items-start gap-3 rounded-control px-3 py-2.5 text-left',
    'transition-colors duration-fast hover:bg-subtle',
    className,
  );

  return notification.href ? (
    <Link href={notification.href} className={baseClasses}>
      {body}
    </Link>
  ) : (
    <div className={baseClasses}>{body}</div>
  );
}
