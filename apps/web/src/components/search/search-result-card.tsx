import {
  BadgeCheck,
  BookOpen,
  Building2,
  FolderKanban,
  MapPin,
  ThumbsUp,
} from 'lucide-react';
import Link from 'next/link';
import { Fragment } from 'react';
import type { HighlightSegment, SearchHighlight, SearchResult } from '@samadhaan/shared';
import { CategoryBadge } from '@/components/problems/category-badge';
import { PriorityBadge } from '@/components/problems/priority-badge';
import { ProblemStatusBadge } from '@/components/problems/problem-status-badge';
import { SeverityBadge } from '@/components/problems/severity-badge';
import { Badge } from '@/components/ui/badge';
import { formatRelativeTime } from '@/lib/format';
import { human } from '@/lib/search';

/**
 * Highlighted text: matched segments in `<mark>`, everything as React text.
 * The server sends segments, not HTML, so nothing in a result can become
 * markup.
 */
export function Highlighted({
  segments,
  fallback,
}: {
  segments?: HighlightSegment[];
  fallback: string;
}) {
  if (!segments || segments.length === 0) return <>{fallback}</>;
  return (
    <>
      {segments.map((segment, i) =>
        segment.match ? (
          <mark key={i} className="rounded-sm bg-warning-soft px-0.5 text-ink">
            {segment.text}
          </mark>
        ) : (
          // A bare text node: wrapping it would let name computation drop the spaces.
          <Fragment key={i}>{segment.text}</Fragment>
        ),
      )}
    </>
  );
}

const field = (highlights: SearchHighlight[], name: string) =>
  highlights.find((h) => h.field === name)?.segments;

const ICON = {
  PROBLEM: MapPin,
  ORGANIZATION: Building2,
  KNOWLEDGE: BookOpen,
  PROJECT: FolderKanban,
};

/** One compact result card, for any entity type. */
export function SearchResultCard({ result }: { result: SearchResult }) {
  const Icon = ICON[result.type];
  const snippet =
    field(result.highlights, 'description') ??
    field(result.highlights, 'excerpt') ??
    field(result.highlights, 'summary');
  return (
    <article className="rounded-card border border-border bg-surface p-4 transition-colors hover:border-border-strong">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0 rounded-control bg-subtle p-1.5 text-ink-subtle">
          <Icon className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="type-body font-medium text-ink">
            <Link href={result.href} className="hover:underline focus-visible:underline">
              <Highlighted
                segments={field(result.highlights, 'title')}
                fallback={result.title}
              />
            </Link>
          </h3>
          {result.subtitle && (
            <p className="mt-0.5 type-caption text-ink-muted">{result.subtitle}</p>
          )}
          {snippet && (
            <p className="mt-1.5 line-clamp-3 type-body-sm text-ink-muted">
              <Highlighted segments={snippet} fallback="" />
            </p>
          )}
          <Meta result={result} />
          {result.explanation.length > 0 && (
            <p className="mt-2 type-caption text-ink-subtle">
              <span className="sr-only">Why this result: </span>
              {result.explanation.join(' · ')}
            </p>
          )}
        </div>
      </div>
    </article>
  );
}

function Meta({ result }: { result: SearchResult }) {
  switch (result.type) {
    case 'PROBLEM': {
      const m = result.metadata;
      return (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <CategoryBadge category={m.category} size="sm" short />
          <ProblemStatusBadge status={m.status} size="sm" />
          <SeverityBadge severity={m.severity} size="sm" showBars={false} />
          {m.priority && <PriorityBadge tier={m.priority} size="sm" />}
          <span className="inline-flex items-center gap-1 type-caption text-ink-subtle">
            <ThumbsUp className="size-3" aria-hidden="true" />
            {m.voteCount}
            <span className="sr-only"> supporters</span>
          </span>
          {m.distanceKm !== null && (
            <span className="type-caption text-ink-subtle">{m.distanceKm} km away</span>
          )}
          <span className="type-caption text-ink-subtle">
            {formatRelativeTime(m.createdAt)}
          </span>
        </div>
      );
    }
    case 'ORGANIZATION': {
      const m = result.metadata;
      return (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {m.verified && (
            <Badge
              tone="success"
              size="sm"
              icon={<BadgeCheck className="size-3" aria-hidden="true" />}
            >
              Verified
            </Badge>
          )}
          {m.expertise.slice(0, 3).map((c) => (
            <CategoryBadge key={c} category={c} size="sm" short />
          ))}
        </div>
      );
    }
    case 'KNOWLEDGE':
      return (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Badge tone="info" size="sm">
            {human(result.metadata.sourceType)}
          </Badge>
          <Badge tone="neutral" size="sm">
            {human(result.metadata.visibility)}
          </Badge>
          <span className="type-caption text-ink-subtle">
            Relevance {Math.round(result.score * 100)}%
          </span>
        </div>
      );
    case 'PROJECT':
      return (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Badge tone="neutral" size="sm">
            {human(result.metadata.status)}
          </Badge>
          <span className="type-caption text-ink-subtle">
            {result.metadata.governmentName}
          </span>
        </div>
      );
  }
}
