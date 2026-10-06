import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/ui/toast';
import { ApiError } from '@/lib/api-error';
import { renderWithProviders, screen, waitFor, within } from '@/test/render';
import {
  governmentContext,
  governmentDashboard,
  problemDetail,
  queueItem,
} from '@/test/government-fixtures';
import { routerMock, searchParamsMock } from '../../../vitest.setup';
import { CivicTrendChart } from './civic-trend-chart';
import { GovernmentDashboard } from './government-dashboard';
import { GovernmentProblemView } from './government-problem-view';
import { InternalNotes } from './internal-notes';
import { ReviewActions } from './review-actions';
import { ReviewList } from './review-list';

const service = vi.hoisted(() => ({
  fetchGovernmentProblems: vi.fn(),
  changeProblemStatus: vi.fn(),
  addInternalNote: vi.fn(),
}));
vi.mock('@/services/government.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/government.service')>()),
  ...service,
}));
// The organisation-matches section fetches on its own and has its own tests.
vi.mock('@/components/matching/problem-organization-matches', () => ({
  ProblemOrganizationMatches: () => <div data-testid="matches" />,
}));

const render = (ui: ReactElement) =>
  renderWithProviders(<ToastProvider>{ui}</ToastProvider>);

function resetParams(entries: Record<string, string> = {}) {
  for (const key of [...searchParamsMock.keys()]) searchParamsMock.delete(key);
  for (const [key, value] of Object.entries(entries)) searchParamsMock.set(key, value);
}

describe('GovernmentDashboard', () => {
  it('is a command centre for the office, with real counts', () => {
    render(
      <GovernmentDashboard
        context={governmentContext()}
        data={governmentDashboard()}
        hour={15}
      />,
    );

    expect(screen.getByText('Civic Intelligence Command Center')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Good afternoon, Priya.' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Gurgaon Municipal Corporation')).toBeInTheDocument();
    expect(screen.getByText(/Jurisdiction:/)).toBeInTheDocument();

    const overview = screen.getByRole('region', { name: 'Overview' });
    for (const [label, value] of [
      ['Total reports', '1,284'],
      ['Pending review', '186'],
      ['High or critical', '74'],
      ['Resolved', '512'],
    ]) {
      expect(
        within(overview).getByText(label).closest('div.rounded-card'),
      ).toHaveTextContent(value!);
    }
  });

  it('shows the review queue and real audit activity', () => {
    render(
      <GovernmentDashboard context={governmentContext()} data={governmentDashboard()} />,
    );

    const queue = screen.getByRole('region', { name: 'Needs review' });
    expect(
      within(queue).getByRole('link', {
        name: 'Large pothole causing traffic disruption',
      }),
    ).toHaveAttribute('href', '/government/gurgaon-mc/problems/SAM-1023');
    expect(queue).toHaveTextContent('94% confidence');
    expect(queue).toHaveTextContent('1 possible duplicate');
    expect(screen.getByText('SAM-1023 verified')).toBeInTheDocument();
    expect(screen.getByText(/Priya Mehta/)).toBeInTheDocument();
  });

  it('has range links and an empty queue state', () => {
    render(
      <GovernmentDashboard
        context={governmentContext()}
        data={governmentDashboard({ reviewQueue: [], recentActivity: [] })}
      />,
    );
    expect(screen.getByRole('link', { name: '30 days' })).toHaveAttribute(
      'href',
      '/government/gurgaon-mc/dashboard?range=30',
    );
    expect(screen.getByRole('link', { name: '7 days' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(screen.getByText('Nothing waiting for review')).toBeInTheDocument();
    expect(screen.getByText('No review activity yet.')).toBeInTheDocument();
  });
});

describe('CivicTrendChart', () => {
  it('gives screen readers the numbers as a table', () => {
    render(<CivicTrendChart points={governmentDashboard().trend.points} />);
    const table = screen.getByRole('table');
    expect(
      within(table).getByText(/28 reported and 3 resolved over 7 days/),
    ).toBeInTheDocument();
    expect(within(table).getAllByRole('row')).toHaveLength(8);
  });
});

describe('ReviewList', () => {
  beforeEach(() => {
    resetParams();
    service.fetchGovernmentProblems.mockReset();
  });

  const page = (items = [queueItem()]) => ({
    items,
    page: 1,
    limit: 20,
    totalCount: items.length,
    totalPages: 1,
  });

  it('loads the queue from the server, then lists it', async () => {
    let resolve!: (value: unknown) => void;
    service.fetchGovernmentProblems.mockReturnValue(new Promise((r) => (resolve = r)));
    render(<ReviewList slug="gurgaon-mc" />);
    expect(screen.getByText('Loading reports')).toBeInTheDocument();

    resolve(page());
    expect(
      await screen.findByRole('list', { name: 'Reports needing review' }),
    ).toHaveTextContent('Large pothole causing traffic disruption');
    expect(service.fetchGovernmentProblems).toHaveBeenCalledWith(
      'gurgaon-mc',
      expect.any(Object),
      expect.any(AbortSignal),
    );
  });

  it('sends only known filter values to the server', async () => {
    service.fetchGovernmentProblems.mockResolvedValue(page());
    resetParams({
      severity: 'HIGH',
      aiStatus: 'completed',
      status: 'DRAFT',
      reportedFrom: 'nonsense',
    });
    render(<ReviewList slug="gurgaon-mc" />);
    await waitFor(() => expect(service.fetchGovernmentProblems).toHaveBeenCalled());
    const query = service.fetchGovernmentProblems.mock.calls[0]![1];
    expect(query).toMatchObject({ severity: 'HIGH', aiStatus: 'completed' });
    expect(query.status).toBeUndefined();
    expect(query.reportedFrom).toBeUndefined();
  });

  it('debounces search into the URL', async () => {
    service.fetchGovernmentProblems.mockResolvedValue(page());
    render(<ReviewList slug="gurgaon-mc" />);
    await userEvent.type(
      screen.getByRole('searchbox', { name: /Search by reference/ }),
      'SAM-1023',
    );
    expect(routerMock.replace).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(routerMock.replace).toHaveBeenCalledWith('/?q=SAM-1023', { scroll: false }),
    );
  });

  it('switches to all reports, where status becomes a filter', async () => {
    service.fetchGovernmentProblems.mockResolvedValue(page());
    render(<ReviewList slug="gurgaon-mc" />);
    await userEvent.click(screen.getByRole('tab', { name: 'All reports' }));
    expect(routerMock.replace).toHaveBeenCalledWith('/?view=all', { scroll: false });
  });

  it('shows empty and error states', async () => {
    service.fetchGovernmentProblems.mockResolvedValueOnce(page([]));
    const { unmount } = render(<ReviewList slug="gurgaon-mc" />);
    expect(await screen.findByText('Nothing waiting for review')).toBeInTheDocument();
    unmount();

    service.fetchGovernmentProblems
      .mockRejectedValueOnce(
        new ApiError({
          code: 'INTERNAL_ERROR',
          message: 'x',
          status: 500,
          requestId: 'r-1',
        }),
      )
      .mockResolvedValueOnce(page());
    render(<ReviewList slug="gurgaon-mc" />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("We couldn't load the review queue.");
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByText('Large pothole causing traffic disruption'),
    ).toBeInTheDocument();
  });
});

describe('ReviewActions', () => {
  beforeEach(() => service.changeProblemStatus.mockReset());

  it('offers only the transitions the API allowed', () => {
    render(
      <ReviewActions
        slug="gurgaon-mc"
        publicId="SAM-1023"
        status="SUBMITTED"
        allowed={['UNDER_REVIEW']}
      />,
    );
    expect(screen.getByRole('button', { name: 'Start review' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Verify' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Allocate|Resolve/ }),
    ).not.toBeInTheDocument();
  });

  it('says what comes next once verified', () => {
    render(
      <ReviewActions
        slug="gurgaon-mc"
        publicId="SAM-1023"
        status="VERIFIED"
        allowed={[]}
      />,
    );
    expect(
      screen.getByRole('link', { name: 'allocate it to an organisation' }),
    ).toHaveAttribute('href', '#allocation');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('requires a reason to reject, then records the decision', async () => {
    service.changeProblemStatus.mockResolvedValue({
      status: 'REJECTED',
      allowedTransitions: [],
    });
    render(
      <ReviewActions
        slug="gurgaon-mc"
        publicId="SAM-1023"
        status="UNDER_REVIEW"
        allowed={['VERIFIED', 'REJECTED']}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Reject' }));
    const dialog = await screen.findByRole('dialog', { name: 'Reject SAM-1023?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reject' }));
    expect(await within(dialog).findByText(/Give a reason/)).toBeInTheDocument();
    expect(service.changeProblemStatus).not.toHaveBeenCalled();

    await userEvent.type(
      within(dialog).getByLabelText('Reason (required)'),
      'Private property, not civic.',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reject' }));
    expect(service.changeProblemStatus).toHaveBeenCalledWith(
      'gurgaon-mc',
      'SAM-1023',
      'REJECTED',
      'Private property, not civic.',
    );
    expect(routerMock.refresh).toHaveBeenCalled();
  });

  it('shows the server refusal when someone else got there first', async () => {
    service.changeProblemStatus.mockRejectedValueOnce(
      new ApiError({
        code: 'CONFLICT',
        message: 'Someone else changed this problem while you were reviewing it.',
        status: 409,
      }),
    );
    render(
      <ReviewActions
        slug="gurgaon-mc"
        publicId="SAM-1023"
        status="UNDER_REVIEW"
        allowed={['VERIFIED']}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Verify' }));
    expect(
      await within(dialog).findByText(/Someone else changed this problem/),
    ).toBeInTheDocument();
  });
});

describe('InternalNotes', () => {
  it('lists notes and adds one through the API', async () => {
    service.addInternalNote.mockResolvedValue({});
    render(
      <InternalNotes
        slug="gurgaon-mc"
        publicId="SAM-1023"
        canAdd
        notes={[
          {
            id: 'n1',
            body: 'Site inspection required before allocation.',
            visibility: 'INTERNAL',
            author: { name: 'Priya Mehta' },
            createdAt: '2026-10-06T09:00:00.000Z',
          },
        ]}
      />,
    );
    expect(
      screen.getByText('Only officials of your office can see these.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Site inspection required before allocation.'),
    ).toBeInTheDocument();

    await userEvent.type(
      screen.getByLabelText('Add an internal note'),
      'Called the contractor.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add note' }));
    expect(service.addInternalNote).toHaveBeenCalledWith(
      'gurgaon-mc',
      'SAM-1023',
      'Called the contractor.',
    );
  });
});

describe('GovernmentProblemView', () => {
  it('shows the report, AI transparency, duplicate and community evidence', () => {
    render(
      <GovernmentProblemView context={governmentContext()} detail={problemDetail()} />,
    );

    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'Large pothole causing traffic disruption',
      }),
    ).toBeInTheDocument();
    const ai = screen.getByText('AI problem intelligence').closest('section')!;
    expect(ai).toHaveTextContent('Samadhaan Vision Model');
    expect(ai).toHaveTextContent('v1.2');
    expect(ai).toHaveTextContent('94%');
    expect(ai).toHaveTextContent('Large road damage creating a potential safety hazard.');

    const duplicates = screen.getByText('Duplicate intelligence').closest('section')!;
    expect(duplicates).toHaveTextContent('Likely duplicate');
    expect(duplicates).toHaveTextContent('87% similar');
    expect(duplicates).toHaveTextContent('300 m away');
    expect(duplicates).toHaveTextContent('A possible duplicate is not a confirmed one');

    const community = screen.getByText('Community evidence').closest('section')!;
    expect(community).toHaveTextContent('124');
    expect(community).toHaveTextContent('not proof');

    expect(screen.getByRole('button', { name: 'Verify' })).toBeInTheDocument();
    expect(screen.getByTestId('matches')).toBeInTheDocument();
  });

  it('does not invent a confidence the model did not give', () => {
    const detail = problemDetail();
    render(
      <GovernmentProblemView
        context={governmentContext()}
        detail={{ ...detail, analysis: { ...detail.analysis!, confidence: null } }}
      />,
    );
    expect(screen.queryByText('AI confidence')).not.toBeInTheDocument();
  });
});
