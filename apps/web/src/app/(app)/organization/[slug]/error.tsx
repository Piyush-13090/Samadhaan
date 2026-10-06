'use client';

import { useEffect } from 'react';
import { PageContainer } from '@/components/layout/page-container';
import { Card } from '@/components/ui/card';
import { ErrorState } from '@/components/ui/states';

/** A workspace page threw. Never shows the error itself — only its digest. */
export default function WorkspaceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Workspace error:', error);
  }, [error]);

  return (
    <PageContainer width="wide">
      <Card>
        <ErrorState
          title="We couldn't load your organization workspace."
          description="Try again."
          reference={error.digest}
          onRetry={reset}
        />
      </Card>
    </PageContainer>
  );
}
