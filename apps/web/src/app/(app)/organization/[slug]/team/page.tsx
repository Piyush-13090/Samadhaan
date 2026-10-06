import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageContainer, PageHeading } from '@/components/layout/page-container';
import { TeamManager } from '@/components/workspace/team-manager';
import { WorkspaceUnavailable } from '@/components/workspace/workspace-unavailable';
import { requestCookieHeader } from '@/lib/request-cookies';
import {
  fetchMembersOnServer,
  fetchWorkspaceOnServer,
} from '@/services/workspace.service';

export const metadata: Metadata = { title: 'Team' };

/**
 * The organisation's people. Members read; owners and admins also manage —
 * the API decides which, and re-checks every change.
 */
export default async function WorkspaceTeamPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const header = await requestCookieHeader();
  const result = await fetchWorkspaceOnServer(slug, header);
  if (result.kind !== 'ok') notFound();

  const { organization, membership, permissions } = result.workspace;
  const members = await fetchMembersOnServer(organization.id, header);

  return (
    <PageContainer>
      <PageHeading
        title="Team"
        description={
          permissions.canManageMembers
            ? 'Invite colleagues, set their roles, and remove access.'
            : `The people working on Samadhaan for ${organization.name}.`
        }
      />
      <div className="mt-6">
        {members ? (
          <TeamManager
            organizationId={organization.id}
            members={members}
            viewerMembershipId={membership.id}
            viewerRole={membership.membershipRole}
            permissions={permissions}
          />
        ) : (
          <WorkspaceUnavailable title="We couldn't load the team." />
        )}
      </div>
    </PageContainer>
  );
}
