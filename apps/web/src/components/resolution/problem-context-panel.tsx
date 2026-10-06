import { Building2, Landmark, MapPin, Sparkles } from 'lucide-react';
import Link from 'next/link';
import type { ResolutionRoomView } from '@samadhaan/shared';
import { CategoryBadge } from '@/components/problems/category-badge';
import { ProblemStatusBadge } from '@/components/problems/problem-status-badge';
import { SeverityBadge } from '@/components/problems/severity-badge';
import { Card, CardBody } from '@/components/ui/card';
import { formatDate } from '@/lib/format';

/** The problem, always in view: what everyone in the room is working on. */
export function ProblemContextPanel({ room }: { room: ResolutionRoomView }) {
  const { problem } = room;
  const place = [problem.address, problem.city].filter(Boolean).join(', ');

  return (
    <Card>
      {problem.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- storage-served media
        <img
          src={problem.imageUrl}
          alt={`Reported photo of ${problem.title}`}
          className="aspect-video w-full rounded-t-card bg-subtle object-cover"
        />
      )}
      <CardBody className="space-y-4">
        <div>
          <p className="font-mono type-caption text-ink-subtle">{problem.publicId}</p>
          <h2 className="mt-1 type-h4 text-ink">{problem.title}</h2>
        </div>

        <dl className="space-y-3 type-body-sm">
          <Row label="Status">
            <ProblemStatusBadge status={problem.status} size="sm" />
          </Row>
          <Row label="Severity">
            <SeverityBadge severity={problem.severity} size="sm" />
          </Row>
          <Row label="Category">
            <span className="inline-flex flex-wrap items-center gap-1">
              <CategoryBadge category={problem.category} size="sm" />
              {problem.subcategory && (
                <span className="text-ink-muted">→ {problem.subcategory}</span>
              )}
            </span>
          </Row>
          {place && (
            <Row label="Location">
              <span className="inline-flex items-start gap-1 text-ink">
                <MapPin
                  className="mt-0.5 size-3.5 shrink-0 text-ink-subtle"
                  aria-hidden="true"
                />
                {place}
              </span>
            </Row>
          )}
        </dl>

        <p className="whitespace-pre-line type-body-sm text-ink-muted">
          {problem.description}
        </p>

        {problem.analysis?.summary && (
          <div className="rounded-control border border-ai-border bg-ai-soft/50 px-3 py-2">
            <p className="flex items-center gap-1.5 type-caption font-medium text-ai">
              <Sparkles className="size-3.5" aria-hidden="true" />
              AI analysis
            </p>
            <p className="mt-1 type-caption text-ink-muted">{problem.analysis.summary}</p>
          </div>
        )}

        <dl className="space-y-2 border-t border-border-subtle pt-4 type-caption">
          <Row label="Government authority">
            <span className="inline-flex items-center gap-1 text-ink">
              <Landmark className="size-3.5 text-ink-subtle" aria-hidden="true" />
              {room.government.name}
            </span>
          </Row>
          <Row label="Assigned organisation">
            <span className="inline-flex items-center gap-1 text-ink">
              <Building2 className="size-3.5 text-ink-subtle" aria-hidden="true" />
              {room.organization.name}
            </span>
          </Row>
          {room.allocation.acceptedAt && (
            <Row label="Allocation accepted">
              {formatDate(room.allocation.acceptedAt)}
            </Row>
          )}
          <Row label="Room opened">{formatDate(room.createdAt)}</Row>
        </dl>

        {room.allocation.instructions && (
          <div>
            <p className="type-caption font-medium text-ink-subtle">
              Allocation instructions
            </p>
            <p className="mt-1 whitespace-pre-line type-caption text-ink-muted">
              {room.allocation.instructions}
            </p>
          </div>
        )}

        <Link
          href={`/problems/${encodeURIComponent(problem.publicId)}`}
          className="inline-block type-caption font-medium text-primary underline-offset-2 hover:underline"
        >
          Public problem page
        </Link>
      </CardBody>
    </Card>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <dt className="text-ink-subtle">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}
