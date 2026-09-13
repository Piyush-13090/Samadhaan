import { Calendar, MapPin, MessageSquare, TrendingUp } from 'lucide-react';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { PageContainer } from '@/components/layout/page-container';
import { MapPlaceholder } from '@/components/problems/map-placeholder';
import { CategoryBadge } from '@/components/problems/category-badge';
import { ProblemStatusBadge } from '@/components/problems/problem-status-badge';
import { SeverityBadge } from '@/components/problems/severity-badge';
import { Alert } from '@/components/ui/alert';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Skeleton, SkeletonText } from '@/components/ui/skeleton';
import { formatDate, formatNumber } from '@/lib/format';
import { ProblemIntelligencePanel } from '@/components/ai/problem-intelligence-panel';
import { fetchAnalysisOnServer, fetchProblemOnServer } from '@/services/problems.service';

interface PageProps {
  params: Promise<{ publicId: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { publicId } = await params;

  return { title: publicId.toUpperCase() };
}

/**
 * A reported problem.
 *
 * Deliberately minimal: it shows what exists today. The AI analysis panel,
 * duplicate candidates, community actions and the resolution timeline arrive in
 * later milestones and attach here without reshaping the page.
 */
export default async function ProblemDetailPage({ params }: PageProps) {
  const { publicId } = await params;

  return (
    <PageContainer>
      <Suspense fallback={<ProblemSkeleton />}>
        <ProblemContent publicId={publicId} />
      </Suspense>
    </PageContainer>
  );
}

async function ProblemContent({ publicId }: { publicId: string }) {
  const cookieStore = await cookies();
  const header = cookieStore
    .getAll()
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');

  const problem = await fetchProblemOnServer(publicId, header);
  if (!problem) notFound();

  // Resolved server-side so a completed analysis renders on the first paint;
  // the panel only polls when one is still in flight.
  const analysis = await fetchAnalysisOnServer(publicId, header);

  const primary = problem.images.find((image) => image.isPrimary) ?? problem.images[0];
  const gallery = problem.images.filter((image) => image.id !== primary?.id);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono type-caption text-ink-subtle">{problem.publicId}</span>
        <ProblemStatusBadge status={problem.status} size="sm" />
        <CategoryBadge category={problem.category} size="sm" />
        {problem.isOwnReport && (
          <Badge tone="primary" size="sm">
            Your report
          </Badge>
        )}
      </div>

      <h1 className="mt-3 type-h1 text-ink">{problem.title}</h1>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 type-caption text-ink-muted">
        <span className="inline-flex items-center gap-1.5">
          <Calendar className="size-3.5" aria-hidden="true" />
          Reported {formatDate(problem.createdAt)}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <TrendingUp className="size-3.5" aria-hidden="true" />
          {formatNumber(problem.voteCount)} supporters
        </span>
        <span className="inline-flex items-center gap-1.5">
          <MessageSquare className="size-3.5" aria-hidden="true" />
          {formatNumber(problem.commentCount)} comments
        </span>
      </div>

      <div className="mt-8 grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-5">
          {primary && (
            <Card className="overflow-hidden p-0">
              {/* eslint-disable-next-line @next/next/no-img-element --
                  media is served from a storage-backed route, not the app's
                  image pipeline; next/image would proxy it needlessly. */}
              <img
                src={primary.url}
                alt={`Photo of the reported problem: ${problem.title}`}
                width={primary.width ?? undefined}
                height={primary.height ?? undefined}
                className="max-h-[28rem] w-full bg-subtle object-cover"
              />
            </Card>
          )}

          {gallery.length > 0 && (
            <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4">
              {gallery.map((image) => (
                <li
                  key={image.id}
                  className="overflow-hidden rounded-card border border-border"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- see above */}
                  <img
                    src={image.url}
                    alt={`Additional photo of the reported problem: ${problem.title}`}
                    className="aspect-square w-full bg-subtle object-cover"
                  />
                </li>
              ))}
            </ul>
          )}

          <Card>
            <CardHeader title="What was reported" />
            <CardBody>
              {/* Plain text node. A description is user input and must never be
                  injected as markup. */}
              <p className="type-body whitespace-pre-line text-ink-muted">
                {problem.description}
              </p>

              {problem.subcategory && (
                <p className="mt-4 type-caption text-ink-subtle">
                  Specifically: {problem.subcategory}
                </p>
              )}
            </CardBody>
          </Card>

          <ProblemIntelligencePanel
            publicId={problem.publicId}
            initial={analysis}
            canRetry={problem.isOwnReport === true}
          />

          {!analysis && (
            <Alert tone="info" title="Awaiting review">
              This report has been received. Samadhaan has not yet analysed or verified
              it.
            </Alert>
          )}
        </div>

        <aside className="space-y-5">
          <Card>
            <CardHeader title="Location" />
            <MapPlaceholder
              className="h-36"
              label={problem.location.city ?? 'Reported location'}
            />
            <CardBody className="space-y-2">
              {problem.location.address && (
                <p className="inline-flex items-start gap-2 type-body-sm text-ink">
                  <MapPin
                    className="mt-0.5 size-4 shrink-0 text-ink-subtle"
                    aria-hidden="true"
                  />
                  {problem.location.address}
                </p>
              )}
              <p className="type-caption text-ink-muted">
                {[
                  problem.location.city,
                  problem.location.state,
                  problem.location.postalCode,
                ]
                  .filter(Boolean)
                  .join(', ')}
              </p>
              <p className="font-mono type-caption tabular text-ink-subtle">
                {problem.location.latitude.toFixed(5)},{' '}
                {problem.location.longitude.toFixed(5)}
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Reported by" />
            <CardBody className="flex items-center gap-3">
              {/* Name and avatar only — the API never sends more than this. */}
              <Avatar
                name={problem.reporter.name}
                src={problem.reporter.avatarUrl ?? undefined}
                size="md"
              />
              <div className="min-w-0">
                <p className="truncate type-body-sm font-medium text-ink">
                  {problem.reporter.name}
                </p>
                <p className="type-caption text-ink-subtle">
                  {formatDate(problem.createdAt)}
                </p>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Assessment" />
            <CardBody className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <span className="type-caption text-ink-muted">Severity</span>
                <SeverityBadge severity={problem.severity} size="sm" />
              </div>
              {/* The problem's own severity, deliberately distinct from the AI's.
                  AI recommends; a reviewer decides, and the two must stay
                  visibly separate until one does. */}
              <p className="type-caption text-ink-subtle">
                This is the recorded severity. Samadhaan AI&rsquo;s assessment is shown
                separately and is confirmed by a reviewer before any decision.
              </p>
            </CardBody>
          </Card>
        </aside>
      </div>
    </>
  );
}

function ProblemSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading problem">
      <Skeleton className="h-5 w-40" />
      <Skeleton className="mt-3 h-9 w-3/4" />
      <Skeleton className="mt-3 h-4 w-64" />

      <div className="mt-8 grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-5">
          <Skeleton className="h-72" />
          <div className="rounded-card border border-border bg-surface p-5">
            <SkeletonText lines={4} />
          </div>
        </div>
        <div className="space-y-5">
          <Skeleton className="h-64" />
          <Skeleton className="h-32" />
        </div>
      </div>
    </div>
  );
}
