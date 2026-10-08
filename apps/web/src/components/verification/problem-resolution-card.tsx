import { BadgeCheck } from 'lucide-react';
import type { PublicResolution } from '@samadhaan/shared';
import { Card, CardBody } from '@/components/ui/card';
import { formatDate } from '@/lib/format';

/**
 * On a public problem page once a government office has verified the
 * resolution (Prompt 22). Public facts only: when, and by which office —
 * never the evidence, the AI review, or any note.
 */
export function ProblemResolutionCard({ resolution }: { resolution: PublicResolution }) {
  return (
    <Card className="border-success-border">
      <CardBody className="space-y-1.5">
        <p className="flex items-center gap-1.5 type-h4 text-success">
          <BadgeCheck className="size-5" aria-hidden="true" /> Resolved
        </p>
        <dl className="grid gap-1 type-body-sm">
          <div>
            <dt className="type-caption text-ink-subtle">Verified by</dt>
            <dd className="text-ink">{resolution.verifiedBy}</dd>
          </div>
          <div>
            <dt className="type-caption text-ink-subtle">Resolved on</dt>
            <dd className="text-ink">
              <time dateTime={resolution.resolvedAt}>
                {formatDate(resolution.resolvedAt)}
              </time>
            </dd>
          </div>
        </dl>
        <p className="type-caption text-ink-subtle">
          A government official reviewed the completion evidence and approved it.
        </p>
      </CardBody>
    </Card>
  );
}
