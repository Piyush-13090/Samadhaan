import type { Metadata } from 'next';
import { PageContainer, PageHeading } from '@/components/layout/page-container';
import { ReportPreview } from './report-preview';

export const metadata: Metadata = { title: 'Report a problem' };

/**
 * Reporting flow — design preview.
 *
 * The real capture, upload and AI pipeline belong to the problem reporting
 * milestone. This page exists so the components that flow will need — the AI
 * processing stages, the insight card, the map placeholder — are designed and
 * reviewable now.
 */
export default function ReportPage() {
  return (
    <PageContainer width="narrow">
      <PageHeading
        title="Report a problem"
        description="A photo and a sentence is enough. Samadhaan handles the rest."
      />
      <ReportPreview />
    </PageContainer>
  );
}
