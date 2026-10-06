import { ShieldAlert } from 'lucide-react';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { GovernmentHeader } from '@/components/government/government-header';
import { PageContainer } from '@/components/layout/page-container';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import { WorkspaceUnavailable } from '@/components/workspace/workspace-unavailable';
import { requireRole } from '@/lib/auth-server';
import { requestCookieHeader } from '@/lib/request-cookies';
import { fetchGovernmentContextOnServer } from '@/services/government.service';

/**
 * A government office's portal. The API is the gate — role, membership,
 * operational office — and this layout renders its answer. Every page beneath
 * asks the API again, which also applies the jurisdiction.
 */
export default async function GovernmentLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  await requireRole(['GOVERNMENT'], `/government/${slug}`);

  const result = await fetchGovernmentContextOnServer(slug, await requestCookieHeader());
  if (result.kind === 'not-found') notFound();

  if (result.kind === 'forbidden') {
    return (
      <PageContainer>
        <Card>
          <EmptyState
            icon={ShieldAlert}
            title="This office's portal is closed"
            description={result.message}
          />
        </Card>
      </PageContainer>
    );
  }
  if (result.kind === 'error') {
    return (
      <PageContainer>
        <WorkspaceUnavailable
          title="We couldn't load the command centre."
          reference={result.reference}
        />
      </PageContainer>
    );
  }

  return (
    <>
      <GovernmentHeader context={result.data} />
      {children}
    </>
  );
}
