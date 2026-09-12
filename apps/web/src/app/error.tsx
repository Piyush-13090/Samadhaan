'use client';

import { useEffect } from 'react';
import { ErrorState } from '@/components/ui/states';

/**
 * Route-level error boundary.
 *
 * Never surfaces the thrown error to the user — `digest` is the handle for
 * correlating with server logs, which is what support actually needs.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Replaced by the error-reporting client in a later milestone.
    console.error('Route error:', error);
  }, [error]);

  return (
    <div className="flex min-h-[60dvh] items-center justify-center px-4">
      <ErrorState
        title="Something went wrong"
        description="We could not load this page. Please try again."
        reference={error.digest}
        onRetry={reset}
      />
    </div>
  );
}
