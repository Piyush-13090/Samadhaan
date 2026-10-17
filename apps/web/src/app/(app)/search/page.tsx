import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageContainer } from '@/components/layout/page-container';
import { SearchPage } from '@/components/search/search-page';
import { LoadingState } from '@/components/ui/states';

export const metadata: Metadata = { title: 'Search' };

/** Unified search (Prompt 25). State lives in the URL; results are access-filtered by the API. */
export default function SearchRoute() {
  return (
    <PageContainer width="wide">
      <h1 className="sr-only">Search Samadhaan</h1>
      <Suspense fallback={<LoadingState label="Loading search" />}>
        <SearchPage />
      </Suspense>
    </PageContainer>
  );
}
