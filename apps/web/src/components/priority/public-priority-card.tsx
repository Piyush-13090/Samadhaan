'use client';

import { useEffect, useState } from 'react';
import type { PublicPriorityView } from '@samadhaan/shared';
import { Badge, StatusDot } from '@/components/ui/badge';
import { Card, CardBody } from '@/components/ui/card';
import { PRIORITY_TIER_DISPLAY } from '@/lib/domain-display';
import { fetchPublicPriority } from '@/services/problems.service';

/**
 * The public face of the priority engine (Prompt 21): an attention level and
 * plain reasons from public signals, once a government office has verified
 * the report. No score, no confidence figures, nothing about a government
 * override or its reason. Renders nothing until there is something to show.
 */
export function PublicPriorityCard({ publicId }: { publicId: string }) {
  const [view, setView] = useState<PublicPriorityView | null>(null);

  useEffect(() => {
    let active = true;
    fetchPublicPriority(publicId)
      .then((next) => active && setView(next))
      .catch(() => undefined); // optional context; the page stands without it
    return () => {
      active = false;
    };
  }, [publicId]);

  if (!view?.level) return null;
  const display = PRIORITY_TIER_DISPLAY[view.level];
  return (
    <Card>
      <CardBody className="space-y-2">
        <p className="flex flex-wrap items-center gap-2 type-label text-ink">
          Attention level
          <Badge tone={display.tone} size="sm" icon={<StatusDot tone={display.tone} />}>
            {display.label}
          </Badge>
        </p>
        {view.reasons.length > 0 && (
          <ul className="list-disc space-y-0.5 pl-5 type-body-sm text-ink-muted">
            {view.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        )}
        <p className="type-caption text-ink-subtle">
          Helps the government office order its review. It is not a decision or a
          deadline.
        </p>
      </CardBody>
    </Card>
  );
}
