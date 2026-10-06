import type { Metadata } from 'next';
import { KnowledgeLibrary } from '@/components/knowledge/knowledge-library';
import { PageContainer, PageHeading } from '@/components/layout/page-container';

export const metadata: Metadata = { title: 'Civic knowledge' };

/** Guidelines, policies and project documents — searchable, with cited answers. */
export default function KnowledgePage() {
  return (
    <PageContainer width="wide">
      <PageHeading
        title="Civic knowledge"
        description="Guidelines, policies and project documents. Answers cite the passages they rest on, and only from sources you may read."
      />
      <div className="mt-6">
        <KnowledgeLibrary />
      </div>
    </PageContainer>
  );
}
