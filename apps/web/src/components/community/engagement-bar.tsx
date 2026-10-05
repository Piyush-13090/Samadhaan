'use client';

import { Bell, BellRing, Heart, MessageSquare, Users } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { formatNumber } from '@/lib/format';
import { useEngagement } from './engagement-context';

/**
 * Community engagement summary and actions for the problem page header.
 *
 * Support and Follow are two separate actions on purpose. Support says "this
 * matters" and is counted as a public civic signal; Follow says "keep me
 * posted" and is a private subscription. One button for both would make every
 * subscriber an endorser.
 *
 * Accessibility: each button's visible text *is* its state — "Support" /
 * "Supported", "Follow" / "Following" — so the name a screen reader announces
 * always matches what a sighted user reads, and the state never rests on the
 * heart's fill colour alone. A polite live region confirms each change.
 */
export function EngagementBar({ className }: { className?: string }) {
  const { engagement, pending, announcement, toggleSupport, toggleFollow } =
    useEngagement();

  const {
    supportCount,
    supportedByCurrentUser,
    followerCount,
    followedByCurrentUser,
    commentCount,
    acceptsEngagement,
    duplicateOfPublicId,
  } = engagement;

  return (
    <div className={cn('space-y-3', className)}>
      <ul
        aria-label="Community engagement"
        className="flex flex-wrap items-center gap-x-4 gap-y-2 type-body-sm text-ink-muted"
      >
        <li className="inline-flex items-center gap-1.5">
          <Heart className="size-4 text-danger" aria-hidden="true" />
          <span className="tabular font-medium text-ink">
            {formatNumber(supportCount)}
          </span>{' '}
          {supportCount === 1 ? 'supporter' : 'supporters'}
        </li>
        <li className="inline-flex items-center gap-1.5">
          <Users className="size-4" aria-hidden="true" />
          <span className="tabular font-medium text-ink">
            {formatNumber(followerCount)}
          </span>{' '}
          following
        </li>
        <li>
          <a
            href="#discussion"
            className="inline-flex items-center gap-1.5 rounded-control hover:text-ink focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
          >
            <MessageSquare className="size-4" aria-hidden="true" />
            <span className="tabular font-medium text-ink">
              {formatNumber(commentCount)}
            </span>{' '}
            {commentCount === 1 ? 'comment' : 'comments'}
          </a>
        </li>
      </ul>

      {acceptsEngagement ? (
        <div className="flex flex-wrap gap-2">
          <Button
            variant={supportedByCurrentUser ? 'subtle' : 'primary'}
            // 44px tall on a phone, where it is tapped with a thumb; the
            // standard height from `sm` up.
            className="h-11 min-w-32 sm:h-10"
            leadingIcon={
              <Heart
                className={cn(supportedByCurrentUser && 'fill-current')}
                aria-hidden="true"
              />
            }
            loading={pending.support}
            onClick={() => void toggleSupport()}
          >
            {supportedByCurrentUser ? 'Supported' : 'Support'}
          </Button>

          <Button
            variant="secondary"
            className="h-11 min-w-32 sm:h-10"
            leadingIcon={
              followedByCurrentUser ? (
                <BellRing aria-hidden="true" />
              ) : (
                <Bell aria-hidden="true" />
              )
            }
            loading={pending.follow}
            onClick={() => void toggleFollow()}
          >
            {followedByCurrentUser ? 'Following' : 'Follow'}
          </Button>
        </div>
      ) : (
        <p className="type-body-sm text-ink-muted">
          {duplicateOfPublicId ? (
            <>
              This report is a duplicate. Support and discuss{' '}
              <Link
                href={`/problems/${duplicateOfPublicId}`}
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                {duplicateOfPublicId}
              </Link>{' '}
              instead.
            </>
          ) : (
            'This report is not open for community activity.'
          )}
        </p>
      )}

      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}
