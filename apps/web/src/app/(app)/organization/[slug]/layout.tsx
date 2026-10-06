import { ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { PageContainer } from '@/components/layout/page-container';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import { WorkspaceHeader } from '@/components/workspace/workspace-header';
import { WorkspaceUnavailable } from '@/components/workspace/workspace-unavailable';
import { requireUser } from '@/lib/auth-server';
import { requestCookieHeader } from '@/lib/request-cookies';
import { fetchWorkspaceOnServer } from '@/services/workspace.service';

/**
 * The organisation workspace.
 *
 * The API is the gate: it resolves the organisation from the slug and checks
 * the signed-in user's active membership. This layout only renders its
 * answer — 404 (not yours, or no such organisation) becomes the not-found
 * page; 403 (suspended) becomes an explanation. There is no client-side
 * permission check to get past, because there is nothing here to get past it
 * to: every page beneath asks the API again.
 */
export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  await requireUser(`/organization/${slug}`);

  const result = await fetchWorkspaceOnServer(slug, await requestCookieHeader());

  if (result.kind === 'not-found') notFound();

  if (result.kind === 'suspended') {
    return (
      <PageContainer>
        <Card>
          <EmptyState
            icon={ShieldAlert}
            title="This organisation is suspended"
            description={`${result.message} Your account and your own reports are unaffected.`}
            action={
              <Button variant="secondary" size="sm" asChild>
                <Link href="/organization">Your organisations</Link>
              </Button>
            }
          />
        </Card>
      </PageContainer>
    );
  }

  if (result.kind === 'error') {
    return (
      <PageContainer>
        <WorkspaceUnavailable reference={result.reference} />
      </PageContainer>
    );
  }

  return (
    <>
      <WorkspaceHeader workspace={result.workspace} />
      {children}
    </>
  );
}
