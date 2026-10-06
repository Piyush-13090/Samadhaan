import { describe, expect, it } from 'vitest';
import { renderWithProviders as render, screen, within } from '@/test/render';
import {
  MEMBER_PERMISSIONS,
  dashboardFixture,
  problemItem,
  recommendationItem,
  workspaceFixture,
} from '@/test/workspace-fixtures';
import { OrganizationDashboard } from './organization-dashboard';

describe('OrganizationDashboard', () => {
  it('counts allocations and points to waiting requests', () => {
    const base = dashboardFixture();
    render(
      <OrganizationDashboard
        workspace={workspaceFixture()}
        data={{
          ...base,
          metrics: { ...base.metrics, pendingAllocations: 2, activeAssignments: 5 },
        }}
      />,
    );

    const overview = screen.getByRole('region', { name: 'Overview' });
    expect(within(overview).getByText('Pending allocations')).toBeInTheDocument();
    expect(within(overview).getByText('Active assignments')).toBeInTheDocument();
    expect(screen.getByText('2 allocation requests are waiting')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Review' })).toHaveAttribute(
      'href',
      '/organization/samadhaan-foundation/allocations',
    );
  });

  it('has no allocation alert when nothing is waiting', () => {
    render(
      <OrganizationDashboard workspace={workspaceFixture()} data={dashboardFixture()} />,
    );
    expect(
      screen.queryByText(/allocation requests? (is|are) waiting/),
    ).not.toBeInTheDocument();
  });

  it('greets the member and names the organisation', () => {
    render(
      <OrganizationDashboard
        workspace={workspaceFixture()}
        data={dashboardFixture()}
        hour={9}
      />,
    );

    expect(
      screen.getByRole('heading', { level: 1, name: 'Good morning, Aarav.' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/happening for Samadhaan Foundation/)).toBeInTheDocument();
  });

  it('shows the counts the API returned, and nothing invented', () => {
    render(
      <OrganizationDashboard workspace={workspaceFixture()} data={dashboardFixture()} />,
    );

    const overview = screen.getByRole('region', { name: 'Overview' });
    for (const [label, value] of [
      ['Recommended', '0'],
      ['In your areas of work', '17'],
      ['New this week', '4'],
      ['Supported by your team', '9'],
      ['Solutions suggested', '2'],
      ['Team members', '3'],
    ]) {
      const metric = within(overview).getByText(label).closest('div.rounded-card');
      expect(metric).toHaveTextContent(value!);
    }
    // No unbuilt metric is dressed up as a measurement.
    expect(screen.queryByText(/resolved/i)).not.toBeInTheDocument();
  });

  it('labels opportunities as discoverable problems, not assignments', () => {
    render(
      <OrganizationDashboard workspace={workspaceFixture()} data={dashboardFixture()} />,
    );

    expect(screen.getByText(/not assigned projects/i)).toBeInTheDocument();
    expect(screen.queryByText(/apply/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/match score/i)).not.toBeInTheDocument();
  });

  it('explains why each problem is listed, and shows the AI classification', () => {
    render(
      <OrganizationDashboard workspace={workspaceFixture()} data={dashboardFixture()} />,
    );

    const opportunities = screen.getByRole('region', { name: 'Civic opportunities' });
    const card = within(opportunities).getByRole('article');
    expect(card).toHaveTextContent('SAM-1023');
    expect(card).toHaveTextContent('Large pothole causing traffic disruption');
    expect(card).toHaveTextContent('Your area of work');
    expect(card).toHaveTextContent('(specialist)');
    expect(card).toHaveTextContent('In your service area');
    expect(card).toHaveTextContent('Roads → Potholes');
    expect(card).toHaveTextContent('94% confidence');
    expect(within(card).getByRole('link')).toHaveAttribute('href', '/problems/SAM-1023');
  });

  it('shows the specified empty state when nothing matches', () => {
    render(
      <OrganizationDashboard
        workspace={workspaceFixture()}
        data={dashboardFixture({ relevantProblems: [], opportunitiesByCategory: [] })}
      />,
    );

    expect(screen.getByText('No relevant civic problems yet.')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Your organisation has not discovered any problems matching its expertise and location.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Browse all problems' })).toHaveAttribute(
      'href',
      '/organization/samadhaan-foundation/problems',
    );
  });

  it('sends a manager to settings when setup is incomplete', () => {
    render(
      <OrganizationDashboard
        workspace={workspaceFixture()}
        data={dashboardFixture({ setup: { hasExpertise: false, hasLocation: true } })}
      />,
    );

    expect(screen.getByText(/none are listed yet/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open settings' })).toHaveAttribute(
      'href',
      '/organization/samadhaan-foundation/settings',
    );
  });

  it('tells a member who can fix setup, without offering them the control', () => {
    render(
      <OrganizationDashboard
        workspace={workspaceFixture({ permissions: MEMBER_PERMISSIONS })}
        data={dashboardFixture({ setup: { hasExpertise: false, hasLocation: false } })}
      />,
    );

    expect(screen.getByText(/An owner or admin can add these/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open settings' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View' })).toBeInTheDocument();
  });

  it('lists opportunity counts per area of work in text, not only as bars', () => {
    render(
      <OrganizationDashboard workspace={workspaceFixture()} data={dashboardFixture()} />,
    );

    const areas = screen.getByText('By area of work').closest('section')!;
    expect(areas).toHaveTextContent('Drainage');
    expect(areas).toHaveTextContent('11');
    expect(areas).toHaveTextContent('6');
  });

  it('leads with AI recommendations once matching has produced them', () => {
    render(
      <OrganizationDashboard
        workspace={workspaceFixture()}
        data={dashboardFixture({
          recommendations: {
            total: 6,
            items: [
              recommendationItem({
                publicId: 'SAM-7',
                title: 'Road damage near Sector 48',
              }),
            ],
          },
        })}
      />,
    );

    const section = screen.getByRole('region', { name: 'Civic opportunities' });
    expect(
      within(section).getByRole('heading', { name: 'Recommended civic opportunities' }),
    ).toBeInTheDocument();
    expect(section).toHaveTextContent('Road damage near Sector 48');
    expect(section).toHaveTextContent('92% relevance');
    expect(section).not.toHaveTextContent(/confidence/i);
    expect(section).not.toHaveTextContent(/apply|accept/i);
    // The rule-based fallback is not shown beside them.
    expect(section).not.toHaveTextContent('Large pothole causing traffic disruption');
    const overview = screen.getByRole('region', { name: 'Overview' });
    expect(
      within(overview).getByText('Recommended').closest('div.rounded-card'),
    ).toHaveTextContent('6');
  });

  it('labels the rule-based list as a fallback until matching has run', () => {
    render(
      <OrganizationDashboard workspace={workspaceFixture()} data={dashboardFixture()} />,
    );
    expect(
      screen.getByText(/Matching hasn.t produced recommendations yet/),
    ).toBeInTheDocument();
  });

  it('shows newest problems in the area separately', () => {
    render(
      <OrganizationDashboard
        workspace={workspaceFixture()}
        data={dashboardFixture({
          recentProblems: [
            problemItem({ publicId: 'SAM-9', title: 'Open manhole', ai: null }),
          ],
        })}
      />,
    );

    const recent = screen.getByRole('region', { name: 'Recently reported in your area' });
    expect(recent).toHaveTextContent('Open manhole');
  });
});
