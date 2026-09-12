'use client';

import { CheckCircle2, ThumbsUp } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatNumber, formatRelativeTime } from '@/lib/format';
import type { SuggestionSummary } from '@/types/domain';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';

/**
 * A proposed solution from the community.
 *
 * Endorsement is presented as a button rather than a count, because the action
 * is the point — the value of suggestions comes from people signalling which
 * one to follow. `onEndorse` is optional so the card renders read-only until
 * the community milestone wires it up.
 */
export function SuggestionCard({
  suggestion,
  onEndorse,
  endorsed = false,
  className,
}: {
  suggestion: SuggestionSummary;
  onEndorse?: () => void;
  endorsed?: boolean;
  className?: string;
}) {
  return (
    <Card
      as="article"
      variant={suggestion.accepted ? 'default' : 'flat'}
      className={cn(
        'p-4',
        suggestion.accepted && 'border-success-border bg-success-soft/40',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <Avatar
            name={suggestion.author.name}
            src={suggestion.author.avatarUrl}
            size="sm"
          />
          <div className="min-w-0">
            <p className="truncate type-body-sm font-medium text-ink">
              {suggestion.author.name}
            </p>
            {suggestion.author.organization && (
              <p className="truncate type-caption text-ink-subtle">
                {suggestion.author.organization}
              </p>
            )}
          </div>
        </div>

        {suggestion.accepted && (
          <Badge tone="success" size="sm" icon={<CheckCircle2 className="size-3" />}>
            Accepted
          </Badge>
        )}
      </div>

      <p className="mt-3 type-body-sm text-ink">{suggestion.content}</p>

      <div className="mt-3.5 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onEndorse}
          disabled={!onEndorse}
          aria-pressed={endorsed}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-control border px-2.5 py-1',
            'type-caption font-medium transition-colors duration-fast',
            endorsed
              ? 'border-primary-border bg-primary-soft text-primary'
              : 'border-border-strong bg-surface text-ink-muted hover:bg-subtle hover:text-ink',
            !onEndorse && 'pointer-events-none',
          )}
        >
          <ThumbsUp className="size-3.5" aria-hidden="true" />
          <span className="tabular">{formatNumber(suggestion.endorsements)}</span>
          <span className="sr-only">endorsements</span>
        </button>

        <time className="type-caption text-ink-subtle" dateTime={suggestion.createdAt}>
          {formatRelativeTime(suggestion.createdAt)}
        </time>
      </div>
    </Card>
  );
}
