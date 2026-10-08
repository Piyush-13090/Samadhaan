import { Award, Lock, Sparkles } from 'lucide-react';
import Link from 'next/link';
import type { BadgeView, LeaderboardEntryView, ReputationView } from '@samadhaan/shared';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ProgressBar } from '@/components/ui/progress-bar';
import { cn } from '@/lib/cn';
import { formatDate, formatNumber } from '@/lib/format';
import { TIER_DISPLAY } from '@/lib/impact';

/** Total impact points and resolved contributions. */
export function ImpactScoreCard({
  impactPoints,
  resolvedContributions,
  href,
}: {
  impactPoints: number;
  resolvedContributions: number;
  /** A link to the full history. */
  href?: string;
}) {
  return (
    <Card>
      <CardBody className="space-y-1">
        <p className="flex items-center gap-1.5 type-label text-ink-muted">
          <Sparkles className="size-4 text-primary" aria-hidden="true" /> Impact points
        </p>
        <p className="tabular text-3xl font-semibold text-ink">
          {formatNumber(impactPoints)}
        </p>
        <p className="type-caption text-ink-muted">
          {resolvedContributions} resolved civic issue
          {resolvedContributions === 1 ? '' : 's'} credited
        </p>
        <p className="type-caption text-ink-subtle">
          Earned for confirmed outcomes — verified reports, confirmed duplicates, resolved
          problems — never for raw activity.
        </p>
        {href && (
          <Link href={href} className="type-body-sm text-primary hover:underline">
            View your impact history
          </Link>
        )}
      </CardBody>
    </Card>
  );
}

/** The reputation tier and score, with public signals only. */
export function ReputationCard({ reputation }: { reputation: ReputationView }) {
  const tier = TIER_DISPLAY[reputation.tier];
  return (
    <Card>
      <CardBody className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="type-label text-ink-muted">Reputation</p>
          <Badge tone={tier.tone}>{tier.label}</Badge>
        </div>
        <div>
          <p className="type-body-sm text-ink">
            Score{' '}
            <span className="tabular text-lg font-semibold">{reputation.score}</span>
            <span className="text-ink-subtle"> / 100</span>
          </p>
          <ProgressBar value={reputation.score} label="Reputation score" size="sm" />
        </div>
        <dl className="grid grid-cols-3 gap-2 text-center">
          {(
            [
              ['Verified reports', reputation.verifiedReports],
              ['Successful contributions', reputation.successfulContributions],
              ['Resolved civic issues', reputation.resolvedContributions],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="rounded-control bg-subtle/60 p-2">
              <dd className="tabular type-h4 text-ink">{value}</dd>
              <dt className="type-caption text-ink-muted">{label}</dt>
            </div>
          ))}
        </dl>
        {reputation.next && (
          <p className="type-caption text-ink-muted">
            Next: {TIER_DISPLAY[reputation.next.tier].label} —{' '}
            {reputation.next.pointsNeeded > 0
              ? `${reputation.next.pointsNeeded} more points`
              : 'points reached'}
            {reputation.next.minimumReputation > 0
              ? `, reputation ${reputation.next.minimumReputation}+`
              : ''}
            .
          </p>
        )}
        <p className="type-caption text-ink-subtle">{reputation.note}</p>
      </CardBody>
    </Card>
  );
}

/** Badges: earned ones first, the rest with what earns them. */
export function BadgeGrid({
  badges,
  compact = false,
}: {
  badges: BadgeView[];
  compact?: boolean;
}) {
  const shown = compact
    ? badges.filter((b) => b.earned)
    : [...badges].sort((a, b) => Number(b.earned) - Number(a.earned));
  return (
    <Card>
      <CardHeader
        title="Badges"
        description={
          compact
            ? undefined
            : 'Earned through real contributions; nobody can assign them.'
        }
      />
      <CardBody>
        {shown.length === 0 ? (
          <p className="type-body-sm text-ink-muted">
            No badges yet. Your first verified report earns one.
          </p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {shown.map((badge) => (
              <li key={badge.key}>
                <BadgeCard badge={badge} />
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

export function BadgeCard({ badge }: { badge: BadgeView }) {
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-control border p-2',
        badge.earned
          ? 'border-success-border bg-success-soft/30'
          : 'border-border-subtle opacity-70',
      )}
    >
      {badge.earned ? (
        <Award className="mt-0.5 size-5 shrink-0 text-success" aria-hidden="true" />
      ) : (
        <Lock className="mt-0.5 size-5 shrink-0 text-ink-subtle" aria-hidden="true" />
      )}
      <div className="min-w-0">
        <p className="type-body-sm font-medium text-ink">
          {badge.name}
          <span className="sr-only">
            {badge.earned ? ' (earned)' : ' (not yet earned)'}
          </span>
        </p>
        <p className="type-caption text-ink-muted">{badge.description}</p>
        <p className="type-caption text-ink-subtle">
          {badge.earned && badge.awardedAt
            ? `Earned ${formatDate(badge.awardedAt)}`
            : badge.criteria}
        </p>
      </div>
    </div>
  );
}

/** One leaderboard row: public name and avatar, points, reputation, resolved work, badges. */
export function LeaderboardRow({ entry }: { entry: LeaderboardEntryView }) {
  const tier = TIER_DISPLAY[entry.reputationTier];
  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-control px-3 py-2.5',
        entry.isViewer ? 'bg-primary-soft' : 'hover:bg-subtle',
      )}
    >
      <span
        className={cn(
          'grid size-8 shrink-0 place-items-center rounded-full tabular type-caption font-semibold',
          entry.rank <= 3 ? 'bg-warning-soft text-warning' : 'text-ink-subtle',
        )}
        aria-label={`Rank ${entry.rank}`}
      >
        {entry.rank}
      </span>
      <Avatar name={entry.user.name} src={entry.user.avatarUrl ?? undefined} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="truncate type-body-sm font-medium text-ink">
          {entry.user.name}
          {entry.isViewer && (
            <span className="ml-1.5 type-caption text-primary">You</span>
          )}
        </p>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 type-caption text-ink-subtle">
          <span>{tier.label}</span>
          <span>· reputation {entry.reputationScore}</span>
          <span>· {entry.resolvedContributions} resolved</span>
          {entry.badges.map((b) => (
            <Badge key={b.key} size="sm" tone="success">
              {b.name}
            </Badge>
          ))}
        </p>
      </div>
      <p className="shrink-0 text-right">
        <span className="tabular type-body-sm font-semibold text-ink">
          {formatNumber(entry.impactPoints)}
        </span>
        <span className="block type-caption text-ink-subtle">points</span>
      </p>
    </div>
  );
}
