'use client';

import { Building2, Info } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ProblemMatches } from '@samadhaan/shared';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { ApiError } from '@/lib/api-error';
import { fetchProblemMatches } from '@/services/matching.service';
import { OrganizationMatchCard } from './organization-match-card';

type Result =
  | { key: number; kind: 'ok'; data: ProblemMatches }
  | { key: number; kind: 'error'; reference?: string };

/**
 * "Organisations that may be able to help" on a problem page.
 *
 * Worded with care: these are potentially relevant organisations found by
 * Samadhaan's matching, not organisations assigned to the problem — no one
 * has allocated it, and nothing here implies anyone will act. A problem that
 * is not open work (a duplicate, a closed report) shows nothing at all.
 */
export function ProblemOrganizationMatches({ publicId }: { publicId: string }) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchProblemMatches(publicId, controller.signal)
      .then((data) => setResult({ key: attempt, kind: 'ok', data }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setResult({
          key: attempt,
          kind: 'error',
          reference: error instanceof ApiError ? error.requestId : undefined,
        });
      });
    return () => controller.abort();
  }, [publicId, attempt]);

  const current = result?.key === attempt ? result : null;
  if (current?.kind === 'ok' && current.data.state === 'unavailable') return null;

  return (
    <Card as="section" aria-labelledby="matches-heading">
      <CardHeader
        title={<span id="matches-heading">Organisations that may be able to help</span>}
        description="Potentially relevant NGOs, universities and industry partners, suggested by Samadhaan's matching."
        icon={<Building2 className="size-4" />}
      />
      <CardBody className="space-y-4">
        {current === null ? (
          <div
            aria-busy="true"
            aria-label="Loading organisations"
            className="grid gap-3 sm:grid-cols-2"
          >
            <Skeleton className="h-52" />
            <Skeleton className="h-52" />
          </div>
        ) : current.kind === 'error' ? (
          <ErrorState
            size="sm"
            title="We couldn't load suggested organisations."
            description="This doesn't affect the report itself."
            reference={current.reference}
            onRetry={() => setAttempt((value) => value + 1)}
          />
        ) : current.data.items.length === 0 ? (
          <EmptyState
            size="sm"
            icon={Building2}
            title={
              current.data.state === 'pending'
                ? 'Looking for organisations'
                : 'No closely matching organisations yet'
            }
            description={
              current.data.state === 'pending'
                ? 'Samadhaan is comparing this problem with organisations’ areas of work. Check back shortly.'
                : 'As more organisations join with relevant expertise, they will appear here.'
            }
          />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {current.data.items.map((match) => (
              <li key={match.organization.slug} className="flex">
                <OrganizationMatchCard match={match} className="w-full" />
              </li>
            ))}
          </ul>
        )}

        <p className="flex items-start gap-2 type-caption text-ink-subtle">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          These are suggestions, not assignments. No organisation has been allocated this
          problem, and relevance reflects how closely its areas of work, profile and
          location fit — not a promise of action.
        </p>
      </CardBody>
    </Card>
  );
}
