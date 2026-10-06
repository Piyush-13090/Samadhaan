import { Info } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { PageContainer, PageHeading } from '@/components/layout/page-container';
import { LoadingState } from '@/components/ui/states';
import { WorkspaceProblems } from '@/components/workspace/workspace-problems';
import { requestCookieHeader } from '@/lib/request-cookies';
import { workspacePath } from '@/lib/workspace';
import { fetchWorkspaceOnServer } from '@/services/workspace.service';

export const metadata: Metadata = { title: 'Recommended civic opportunities' };

/**
 * Recommended civic opportunities: problems Samadhaan's matching engine found
 * potentially relevant to this organisation (Prompt 14).
 *
 * The page says plainly what the score is — relevance from an
 * embedding-assisted heuristic baseline, not a confidence — and what a
 * recommendation is not: an assignment. Owners and admins can mark one not
 * relevant; nobody can accept or apply, because those workflows do not exist.
 */
export default async function WorkspaceOpportunitiesPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const result = await fetchWorkspaceOnServer(slug, await requestCookieHeader());
  if (result.kind !== 'ok') notFound();

  const { coordinates, permissions } = result.workspace;

  return (
    <PageContainer width="wide">
      <PageHeading
        title="Recommended civic opportunities"
        description="Open problems your organisation may be able to help with, ranked by relevance. They are suggestions — not assigned projects."
      />

      <div className="mt-5 flex gap-3 rounded-card border border-info-border bg-info-soft px-4 py-3 type-body-sm text-ink">
        <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden="true" />
        <p>
          <span className="font-medium">How these are found: </span>
          each problem is compared with your organisation&rsquo;s description and areas of
          work using text embeddings, alongside its category, distance from your
          registered location and the kind of work your organisation does. Relevance is a
          weighted score from those signals — not a probability.{' '}
          {permissions.canEditProfile ? (
            <Link
              href={workspacePath(slug, 'settings')}
              className="font-medium text-primary underline-offset-2 hover:underline"
            >
              Keep your areas of work up to date
            </Link>
          ) : (
            'Owners and admins keep the areas of work up to date.'
          )}
          {' · '}
          <Link
            href={workspacePath(slug, 'problems')}
            className="font-medium text-primary underline-offset-2 hover:underline"
          >
            Browse every problem
          </Link>
        </p>
      </div>

      <div className="mt-6">
        <Suspense fallback={<LoadingState label="Loading recommendations" />}>
          <WorkspaceProblems
            slug={slug}
            scope="relevant"
            mode="recommendations"
            hasCoordinates={coordinates !== null}
            canDismiss={permissions.canEditProfile}
          />
        </Suspense>
      </div>
    </PageContainer>
  );
}
