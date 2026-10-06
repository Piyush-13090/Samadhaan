import { ArrowRight, Building2, ShieldAlert } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PageContainer, PageHeading } from '@/components/layout/page-container';
import { VerificationBadge } from '@/components/profile/verification-badge';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import { InvitationList } from '@/components/workspace/invitation-list';
import { requireUser } from '@/lib/auth-server';
import { MEMBERSHIP_ROLE_WITH_ARTICLE } from '@/lib/profile-display';
import { requestCookieHeader } from '@/lib/request-cookies';
import { ORGANIZATION_TYPE_LABEL, workspacePath } from '@/lib/workspace';
import { fetchMyOrganizationsOnServer } from '@/services/workspace.service';

export const metadata: Metadata = { title: 'Organisations' };

/**
 * Where an organisation member lands.
 *
 * With exactly one workspace and nothing to answer, it goes straight there —
 * a chooser with one option is a wasted step. Otherwise it lists the
 * workspaces and any pending invitations.
 *
 * Membership, not platform role, decides what is listed: the API returns the
 * NGO, university and industry organisations this account actively belongs
 * to. A citizen invited to an NGO lands here too.
 */
export default async function OrganizationsPage() {
  await requireUser('/organization');
  const { workspaces, invitations } = await fetchMyOrganizationsOnServer(
    await requestCookieHeader(),
  );

  const accessible = workspaces.filter((workspace) => workspace.isAccessible);
  if (invitations.length === 0 && workspaces.length === 1 && accessible[0]) {
    redirect(workspacePath(accessible[0].slug));
  }

  return (
    <PageContainer>
      <PageHeading
        title="Your organisations"
        description="Choose the organisation you are working for. Each has its own workspace, team and settings."
      />

      <div className="mt-6 space-y-6">
        {invitations.length > 0 && <InvitationList invitations={invitations} />}

        {workspaces.length === 0 ? (
          invitations.length === 0 && (
            <Card>
              <EmptyState
                icon={Building2}
                title="You're not part of an organisation yet"
                description="NGOs, universities and industry partners are onboarded by Samadhaan. When a colleague invites you to their team, the invitation will appear here."
              />
            </Card>
          )
        ) : (
          <section aria-label="Workspaces">
            <ul className="grid gap-3 sm:grid-cols-2">
              {workspaces.map((workspace) => (
                <li key={workspace.slug} className="flex">
                  <Card as="article" interactive className="group relative w-full p-4">
                    <div className="flex items-start gap-3">
                      <Avatar
                        name={workspace.name}
                        src={workspace.logoUrl ?? undefined}
                        size="lg"
                        className="rounded-control"
                      />
                      <div className="min-w-0 flex-1">
                        <h2 className="type-body font-semibold text-ink">
                          <Link
                            href={workspacePath(workspace.slug)}
                            className="outline-none before:absolute before:inset-0"
                          >
                            {workspace.name}
                          </Link>
                        </h2>
                        <p className="mt-0.5 type-caption text-ink-subtle">
                          {ORGANIZATION_TYPE_LABEL[workspace.type]} · You are{' '}
                          {MEMBERSHIP_ROLE_WITH_ARTICLE[workspace.membershipRole]}
                        </p>
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <VerificationBadge
                            status={workspace.verificationStatus}
                            size="sm"
                          />
                          {!workspace.isAccessible && (
                            <Badge tone="danger" size="sm" icon={<ShieldAlert />}>
                              Workspace closed
                            </Badge>
                          )}
                        </div>
                      </div>
                      <ArrowRight
                        className="mt-1 size-4 shrink-0 text-ink-subtle transition-transform group-hover:translate-x-0.5"
                        aria-hidden="true"
                      />
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </PageContainer>
  );
}
