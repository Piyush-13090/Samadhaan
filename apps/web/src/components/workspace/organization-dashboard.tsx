import {
  ArrowRight,
  ClipboardList,
  Inbox,
  MessagesSquare,
  Search,
  Settings,
  Target,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import type {
  OrganizationDashboard as OrganizationDashboardData,
  OrganizationWorkspace,
} from '@samadhaan/shared';
import type { ImpactStat } from '@/types/domain';
import { ImpactMetricGroup } from '@/components/common/impact-metric';
import { SectionHeading } from '@/components/layout/page-container';
import { Alert } from '@/components/ui/alert';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import { CATEGORY_DISPLAY } from '@/lib/domain-display';
import { formatNumber } from '@/lib/format';
import { greeting } from '@/lib/greeting';
import { MEMBERSHIP_ROLE_LABEL } from '@/lib/profile-display';
import { workspacePath } from '@/lib/workspace';
import { OrganizationOpportunityCard } from '@/components/matching/organization-opportunity-card';
import { OrganizationProblemCard } from './organization-problem-card';
import { ProjectCard } from '@/components/project/project-card';

/**
 * The organisation's home.
 *
 * Every number is counted from the database by the API. Nothing that cannot be
 * measured yet — problems this organisation has *resolved* needs resolution,
 * a later milestone — appears here as a zero.
 *
 * Opportunities are labelled as what they are: discoverable problems that
 * match the organisation's declared areas of work and service area. They are
 * not assignments, and nothing here invites anyone to "apply".
 */
export function OrganizationDashboard({
  workspace,
  data,
  hour,
}: {
  workspace: OrganizationWorkspace;
  data: OrganizationDashboardData;
  /** Injected so the greeting is deterministic and testable. */
  hour?: number;
}) {
  const { organization, permissions } = workspace;
  const slug = organization.slug;
  const { metrics, setup, teamSummary } = data;

  const stats: ImpactStat[] = [
    {
      id: 'pending-allocations',
      label: 'Pending allocations',
      value: metrics.pendingAllocations,
      hint: 'Requests from a government office awaiting your response.',
    },
    {
      id: 'active-assignments',
      label: 'Active assignments',
      value: metrics.activeAssignments,
      hint: `Allocated problems your organisation accepted that are in progress. ${metrics.openRooms} open resolution ${metrics.openRooms === 1 ? 'room' : 'rooms'}.`,
    },
    {
      id: 'recommended',
      label: 'Recommended',
      value: data.recommendations.total,
      hint: 'Open problems Samadhaan’s matching found potentially relevant to your organisation.',
    },
    {
      id: 'opportunities',
      label: 'In your areas of work',
      value: metrics.opportunities,
      hint: 'Open problems in one of your declared areas of work and inside your service area.',
    },
    {
      id: 'new',
      label: 'New this week',
      value: metrics.newOpportunities,
      hint: 'Opportunities reported in the last seven days.',
    },
    {
      id: 'supported',
      label: 'Supported by your team',
      value: metrics.problemsSupportedByTeam,
      hint: 'Distinct problems your current members have supported.',
    },
    {
      id: 'suggestions',
      label: 'Solutions suggested',
      value: metrics.suggestionsMade,
      hint: `Suggestions made on behalf of ${organization.name}. ${metrics.suggestionsAccepted} accepted.`,
    },
    {
      id: 'team',
      label: 'Team members',
      value: metrics.teamMembers,
      hint:
        metrics.pendingInvitations !== null && metrics.pendingInvitations > 0
          ? `Active members. ${metrics.pendingInvitations} invitation(s) pending.`
          : 'Active members of this organisation.',
    },
  ];

  const hasRecommendations = data.recommendations.items.length > 0;
  const maxCategory = Math.max(
    1,
    ...data.opportunitiesByCategory.map((row) => row.count),
  );

  return (
    <div className="space-y-10">
      <section className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div>
          <h1 className="type-h1 text-ink">
            {greeting(hour)}, {data.viewer.firstName}.
          </h1>
          <p className="mt-2 type-body-lg text-ink-muted">
            Here&rsquo;s what&rsquo;s happening for {organization.name}.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {metrics.openRooms > 0 && (
            <Button
              variant="secondary"
              size="lg"
              leadingIcon={<MessagesSquare />}
              asChild
            >
              <Link href="/resolution">Resolution rooms ({metrics.openRooms})</Link>
            </Button>
          )}
          <Button variant="primary" size="lg" leadingIcon={<Target />} asChild>
            <Link href={workspacePath(slug, 'opportunities')}>View opportunities</Link>
          </Button>
        </div>
      </section>

      {metrics.pendingAllocations > 0 && (
        <Alert
          tone="warning"
          title={`${metrics.pendingAllocations} allocation ${metrics.pendingAllocations === 1 ? 'request is' : 'requests are'} waiting`}
          action={
            <Button variant="secondary" size="sm" leadingIcon={<Inbox />} asChild>
              <Link href={workspacePath(slug, 'allocations')}>Review</Link>
            </Button>
          }
        >
          A government office has asked your organisation to take on a verified problem.
          {!permissions.canEditProfile && ' An owner or admin can accept or decline.'}
        </Alert>
      )}

      {(!setup.hasExpertise || !setup.hasLocation) && (
        <Alert
          tone="info"
          title="Help Samadhaan find the right problems for you"
          action={
            permissions.canEditProfile ? (
              <Button variant="secondary" size="sm" leadingIcon={<Settings />} asChild>
                <Link href={workspacePath(slug, 'settings')}>Open settings</Link>
              </Button>
            ) : undefined
          }
        >
          {!setup.hasExpertise &&
            'Opportunities come from your areas of work, and none are listed yet. '}
          {!setup.hasLocation &&
            'Without a registered location or city, problems from everywhere count as in your service area. '}
          {!permissions.canEditProfile && 'An owner or admin can add these in Settings.'}
        </Alert>
      )}

      <section aria-labelledby="overview-heading">
        <h2 id="overview-heading" className="sr-only">
          Overview
        </h2>
        <ImpactMetricGroup stats={stats} className="sm:grid-cols-2 lg:grid-cols-4" />
      </section>

      <div className="grid gap-8 lg:grid-cols-3">
        <section aria-label="Civic opportunities" className="lg:col-span-2">
          <SectionHeading
            title={
              hasRecommendations
                ? 'Recommended civic opportunities'
                : 'Civic opportunities'
            }
            description={
              hasRecommendations
                ? 'Problems Samadhaan’s matching found potentially relevant to you — suggestions, not assigned projects.'
                : 'Discoverable problems in your areas of work and service area — not assigned projects.'
            }
            action={
              <Button variant="ghost" size="sm" trailingIcon={<ArrowRight />} asChild>
                <Link href={workspacePath(slug, 'opportunities')}>View all</Link>
              </Button>
            }
          />

          {hasRecommendations ? (
            <ul className="mt-4 grid gap-3 md:grid-cols-2">
              {data.recommendations.items.map((item) => (
                <li key={item.publicId} className="flex">
                  <OrganizationOpportunityCard item={item} className="w-full" />
                </li>
              ))}
            </ul>
          ) : data.relevantProblems.length === 0 ? (
            <Card className="mt-4">
              <EmptyState
                icon={Target}
                title="No relevant civic problems yet."
                description="Your organisation has not discovered any problems matching its expertise and location."
                action={
                  <Button variant="secondary" size="sm" leadingIcon={<Search />} asChild>
                    <Link href={workspacePath(slug, 'problems')}>
                      Browse all problems
                    </Link>
                  </Button>
                }
              />
            </Card>
          ) : (
            <>
              <p className="mt-3 type-caption text-ink-subtle">
                Matching hasn&rsquo;t produced recommendations yet. Meanwhile, these open
                problems are in your areas of work and service area.
              </p>
              <ul className="mt-3 grid gap-3 md:grid-cols-2">
                {data.relevantProblems.map((problem) => (
                  <li key={problem.publicId} className="flex">
                    <OrganizationProblemCard problem={problem} className="w-full" />
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <div className="space-y-5">
          <Card>
            <CardHeader
              title="By area of work"
              description="Open opportunities per declared area."
            />
            <CardBody>
              {data.opportunitiesByCategory.length === 0 ? (
                <p className="type-body-sm text-ink-muted">
                  {setup.hasExpertise
                    ? 'None open in your service area right now.'
                    : 'No areas of work declared yet.'}
                </p>
              ) : (
                <ul className="space-y-3">
                  {data.opportunitiesByCategory.map((row) => (
                    <li key={row.category}>
                      <div className="flex items-baseline justify-between gap-3 type-body-sm">
                        <span className="text-ink">
                          {CATEGORY_DISPLAY[row.category].label}
                        </span>
                        <span className="tabular font-medium text-ink">
                          {formatNumber(row.count)}
                        </span>
                      </div>
                      {/* The number above carries the value; the bar is a
                          visual aid only. */}
                      <div
                        aria-hidden="true"
                        className="mt-1.5 h-1.5 rounded-full bg-subtle"
                      >
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${(row.count / maxCategory) * 100}%` }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Team"
              description={`${teamSummary.total} active ${teamSummary.total === 1 ? 'member' : 'members'}`}
              action={
                <Button variant="ghost" size="sm" leadingIcon={<Users />} asChild>
                  <Link href={workspacePath(slug, 'team')}>
                    {permissions.canManageMembers ? 'Manage' : 'View'}
                  </Link>
                </Button>
              }
            />
            <CardBody className="space-y-3">
              <dl className="flex flex-wrap gap-2">
                {(['OWNER', 'ADMIN', 'MEMBER'] as const).map((role) => (
                  <div key={role}>
                    <dt className="sr-only">{MEMBERSHIP_ROLE_LABEL[role]}s</dt>
                    <dd>
                      <Badge tone="neutral" size="sm">
                        {teamSummary.byRole[role]}{' '}
                        {MEMBERSHIP_ROLE_LABEL[role].toLowerCase()}
                        {teamSummary.byRole[role] === 1 ? '' : 's'}
                      </Badge>
                    </dd>
                  </div>
                ))}
              </dl>
              <ul className="space-y-2">
                {teamSummary.recentMembers.map((member) => (
                  <li key={member.id} className="flex items-center gap-2.5">
                    <Avatar
                      name={member.user.fullName}
                      src={member.user.avatarUrl ?? undefined}
                      size="xs"
                    />
                    <span className="min-w-0 flex-1 truncate type-body-sm text-ink">
                      {member.user.fullName}
                    </span>
                    <span className="type-caption text-ink-subtle">
                      {MEMBERSHIP_ROLE_LABEL[member.membershipRole]}
                    </span>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        </div>
      </div>

      <section aria-label="My active projects">
        <SectionHeading
          title="My active projects"
          description="Resolution projects your organisation is working on, from real task counts."
        />
        {data.projects.length === 0 ? (
          <Card className="mt-4">
            <EmptyState
              size="sm"
              icon={ClipboardList}
              title="No active projects"
              description="A project opens when your organisation accepts a government allocation."
            />
          </Card>
        ) : (
          <ul className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {data.projects.map((project) => (
              <li key={project.id} className="flex">
                <ProjectCard project={project} partner="government" />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Recently reported in your area">
        <SectionHeading
          title="Recently reported in your area"
          description="The newest open problems in your service area, in any category."
          action={
            <Button variant="ghost" size="sm" trailingIcon={<ArrowRight />} asChild>
              <Link href={`${workspacePath(slug, 'problems')}?sort=recent`}>
                See more
              </Link>
            </Button>
          }
        />
        {data.recentProblems.length === 0 ? (
          <Card className="mt-4">
            <EmptyState
              size="sm"
              icon={Search}
              title="Nothing reported nearby yet"
              description="New civic problems in your service area will appear here."
            />
          </Card>
        ) : (
          <ul className="mt-4 grid gap-3 md:grid-cols-2">
            {data.recentProblems.map((problem) => (
              <li key={problem.publicId} className="flex">
                <OrganizationProblemCard problem={problem} className="w-full" />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
