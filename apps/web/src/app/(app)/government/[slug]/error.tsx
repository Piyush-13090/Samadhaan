'use client';

import { useEffect } from 'react';
import { PageContainer } from '@/components/layout/page-container';
import { Card } from '@/components/ui/card';
import { ErrorState } from '@/components/ui/states';

export default function GovernmentError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Government portal error:', error);
  }, [error]);

  return (
    <PageContainer width="wide">
      <Card>
        <ErrorState
          title="We couldn't load the command centre."
          description="Try again."
          reference={error.digest}
          onRetry={reset}
        />
      </Card>
    </PageContainer>
  );
}
