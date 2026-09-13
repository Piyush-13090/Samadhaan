import type { Metadata } from 'next';
import { PageContainer, PageHeading } from '@/components/layout/page-container';
import { ReportForm } from '@/components/report/report-form';
import { Alert } from '@/components/ui/alert';
import { requireRole } from '@/lib/auth-server';

export const metadata: Metadata = {
  title: 'Report a problem',
  description: 'Report a civic problem in your area.',
};

/**
 * The citizen reporting flow.
 *
 * `requireRole` is the page-level check; the API enforces the same restriction
 * on every write, so hiding the page is convenience rather than security. A
 * non-citizen who navigates here is redirected to their own workspace rather
 * than shown a 403 — being told an area exists that they cannot use is both
 * unhelpful and a small disclosure.
 */
export default async function ReportPage() {
  const user = await requireRole(['CITIZEN', 'ADMIN'], '/report');

  return (
    <PageContainer width="narrow">
      <PageHeading
        title="Report a civic problem"
        description="Help your community identify and solve problems faster."
      />

      {user.status === 'PENDING_VERIFICATION' && (
        <Alert tone="info" title="Your email is not verified yet" className="mt-6">
          You can still report problems. Verifying your email helps local bodies trust
          your reports.
        </Alert>
      )}

      <div className="mt-8">
        <ReportForm />
      </div>
    </PageContainer>
  );
}
