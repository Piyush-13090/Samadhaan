'use client';

import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { ErrorState } from '@/components/ui/states';

/**
 * A workspace section that failed to load. Retrying re-runs the server
 * render, which repeats the API's access check rather than trusting a cache.
 */
export function WorkspaceUnavailable({
  title = "We couldn't load your organization workspace.",
  reference,
}: {
  title?: string;
  reference?: string;
}) {
  const router = useRouter();

  return (
    <Card>
      <ErrorState
        title={title}
        description="Try again. If it keeps happening, quote the reference below."
        reference={reference}
        onRetry={() => router.refresh()}
      />
    </Card>
  );
}
