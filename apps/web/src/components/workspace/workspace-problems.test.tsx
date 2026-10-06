import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-error';
import type { ReactElement } from 'react';
import { ToastProvider } from '@/components/ui/toast';
import { renderWithProviders, screen, waitFor, within } from '@/test/render';
import { problemItem, problemPage, recommendationItem } from '@/test/workspace-fixtures';
import { routerMock, searchParamsMock } from '../../../vitest.setup';
import { WorkspaceProblems } from './workspace-problems';

const render = (ui: ReactElement) =>
  renderWithProviders(<ToastProvider>{ui}</ToastProvider>);

const fetchWorkspaceProblems = vi.hoisted(() => vi.fn());
const matchingService = vi.hoisted(() => ({
  fetchRecommendations: vi.fn(),
  setRecommendationDismissed: vi.fn(),
}));

vi.mock('@/services/matching.service', () => matchingService);

vi.mock('@/services/workspace.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/workspace.service')>()),
  fetchWorkspaceProblems,
}));

function resetParams(entries: Record<string, string> = {}) {
  for (const key of [...searchParamsMock.keys()]) searchParamsMock.delete(key);
  for (const [key, value] of Object.entries(entries)) searchParamsMock.set(key, value);
}

describe('WorkspaceProblems', () => {
  beforeEach(() => resetParams());

  it('shows a loading state, then the page of problems from the server', async () => {
    let resolve!: (value: unknown) => void;
    fetchWorkspaceProblems.mockReturnValue(new Promise((r) => (resolve = r)));

    render(<WorkspaceProblems slug="clean-city" scope="all" hasCoordinates />);

    expect(screen.getByText('Loading problems')).toBeInTheDocument();

    resolve(problemPage([problemItem()], { totalCount: 25, totalPages: 3 }));

    expect(
      await screen.findByText('Large pothole causing traffic disruption'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Showing/)).toHaveTextContent('Showing 1–1 of 25');
    expect(fetchWorkspaceProblems).toHaveBeenCalledWith(
      'clean-city',
      expect.objectContaining({ scope: 'all', limit: 12 }),
      expect.any(AbortSignal),
    );
  });

  it('asks the server for opportunities, never filtering locally', async () => {
    fetchWorkspaceProblems.mockResolvedValue(problemPage([]));
    resetParams({ category: 'DRAINAGE', severity: 'HIGH', page: '2' });

    render(<WorkspaceProblems slug="clean-city" scope="relevant" hasCoordinates />);

    await waitFor(() =>
      expect(fetchWorkspaceProblems).toHaveBeenCalledWith(
        'clean-city',
        expect.objectContaining({
          scope: 'relevant',
          category: 'DRAINAGE',
          severity: 'HIGH',
          page: 2,
        }),
        expect.any(AbortSignal),
      ),
    );
  });

  it('ignores values in the URL that are not part of the taxonomy', async () => {
    fetchWorkspaceProblems.mockResolvedValue(problemPage([]));
    resetParams({ category: 'DROP TABLE', severity: 'EXTREME', radiusMeters: '999999' });

    render(<WorkspaceProblems slug="clean-city" scope="all" hasCoordinates />);

    await waitFor(() => expect(fetchWorkspaceProblems).toHaveBeenCalled());
    const query = fetchWorkspaceProblems.mock.calls[0]![1];
    expect(query.category).toBeUndefined();
    expect(query.severity).toBeUndefined();
    expect(query.radiusMeters).toBeUndefined();
  });

  it('shows the opportunities empty state', async () => {
    fetchWorkspaceProblems.mockResolvedValue(problemPage([]));

    render(<WorkspaceProblems slug="clean-city" scope="relevant" hasCoordinates />);

    expect(
      await screen.findByText('No relevant civic problems yet.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Browse all problems' })).toHaveAttribute(
      'href',
      '/organization/clean-city/problems',
    );
  });

  it('offers to clear filters when filters emptied the list', async () => {
    fetchWorkspaceProblems.mockResolvedValue(problemPage([]));
    resetParams({ category: 'WATER' });

    render(<WorkspaceProblems slug="clean-city" scope="all" hasCoordinates />);

    expect(
      await screen.findByText('No problems match these filters'),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(routerMock.replace).toHaveBeenCalledWith('/', { scroll: false });
  });

  it('shows an error with a working retry', async () => {
    fetchWorkspaceProblems
      .mockRejectedValueOnce(
        new ApiError({
          code: 'INTERNAL_ERROR',
          message: 'boom',
          status: 500,
          requestId: 'req-7',
        }),
      )
      .mockResolvedValueOnce(problemPage([problemItem()]));

    render(<WorkspaceProblems slug="clean-city" scope="all" hasCoordinates />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("We couldn't load these problems.");
    expect(alert).toHaveTextContent('req-7');
    expect(alert).not.toHaveTextContent('boom');

    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByText('Large pothole causing traffic disruption'),
    ).toBeInTheDocument();
  });

  it('writes a filter change to the URL and starts again from page one', async () => {
    fetchWorkspaceProblems.mockResolvedValue(problemPage([problemItem()]));
    resetParams({ page: '3' });

    render(<WorkspaceProblems slug="clean-city" scope="all" hasCoordinates />);
    await screen.findByText('Large pothole causing traffic disruption');

    const filters = screen.getAllByRole('group', { name: 'Filter problems' })[0]!;
    await userEvent.click(within(filters).getByRole('combobox', { name: 'Severity' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Critical' }));

    expect(routerMock.replace).toHaveBeenCalledWith('/?severity=CRITICAL', {
      scroll: false,
    });
  });

  it('debounces typed filters before they reach the URL', async () => {
    fetchWorkspaceProblems.mockResolvedValue(problemPage([]));

    render(<WorkspaceProblems slug="clean-city" scope="all" hasCoordinates />);

    const filters = screen.getAllByRole('group', { name: 'Filter problems' })[0]!;
    await userEvent.type(
      within(filters).getByRole('searchbox', { name: 'City' }),
      'Kochi',
    );

    expect(routerMock.replace).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(routerMock.replace).toHaveBeenCalledWith('/?city=Kochi', { scroll: false }),
    );
    expect(routerMock.replace).toHaveBeenCalledTimes(1);
  });

  it('offers distance only when the organisation has a registered location', async () => {
    fetchWorkspaceProblems.mockResolvedValue(problemPage([]));

    const { unmount } = render(
      <WorkspaceProblems slug="clean-city" scope="all" hasCoordinates={false} />,
    );
    await waitFor(() => expect(fetchWorkspaceProblems).toHaveBeenCalled());
    const filters = screen.getAllByRole('group', { name: 'Filter problems' })[0]!;
    expect(
      within(filters).queryByRole('combobox', { name: 'Distance' }),
    ).not.toBeInTheDocument();
    unmount();

    render(<WorkspaceProblems slug="clean-city" scope="all" hasCoordinates />);
    const withLocation = screen.getAllByRole('group', { name: 'Filter problems' })[0]!;
    expect(
      within(withLocation).getByRole('combobox', { name: 'Distance' }),
    ).toBeInTheDocument();
  });

  it('paginates through the server', async () => {
    fetchWorkspaceProblems.mockResolvedValue(
      problemPage([problemItem()], { totalCount: 30, totalPages: 3 }),
    );

    render(<WorkspaceProblems slug="clean-city" scope="all" hasCoordinates />);
    await screen.findByText('Large pothole causing traffic disruption');

    await userEvent.click(screen.getByRole('button', { name: 'Page 2' }));
    expect(routerMock.replace).toHaveBeenCalledWith('/?page=2', { scroll: false });
  });

  it('shows active filters as removable chips', async () => {
    fetchWorkspaceProblems.mockResolvedValue(problemPage([problemItem()]));
    resetParams({ category: 'DRAINAGE', reportedWithinDays: '7' });

    render(<WorkspaceProblems slug="clean-city" scope="all" hasCoordinates />);

    const chips = screen.getByRole('list', { name: 'Active filters' });
    expect(chips).toHaveTextContent('Drainage');
    expect(chips).toHaveTextContent('Last 7 days');

    await userEvent.click(within(chips).getByRole('button', { name: /Drainage/ }));
    expect(routerMock.replace).toHaveBeenCalledWith('/?reportedWithinDays=7', {
      scroll: false,
    });
  });

  describe('recommendations mode', () => {
    it('asks the server for recommendations with the relevance filter', async () => {
      matchingService.fetchRecommendations.mockResolvedValue(
        problemPage([recommendationItem()]) as never,
      );
      resetParams({ minRelevance: '0.7', category: 'ROADS', status: 'RESOLVED' });

      render(
        <WorkspaceProblems
          slug="clean-city"
          scope="relevant"
          mode="recommendations"
          hasCoordinates
        />,
      );

      expect(await screen.findByText('92% relevance')).toBeInTheDocument();
      const query = matchingService.fetchRecommendations.mock.calls[0]![1];
      expect(query).toMatchObject({ minRelevance: 0.7, category: 'ROADS' });
      // Status is not a recommendation filter and is never sent.
      expect(query.status).toBeUndefined();
      expect(fetchWorkspaceProblems).not.toHaveBeenCalled();

      const filters = screen.getAllByRole('group', { name: 'Filter problems' })[0]!;
      expect(
        within(filters).getByRole('combobox', { name: 'Relevance' }),
      ).toBeInTheDocument();
      expect(
        within(filters).queryByRole('combobox', { name: 'Status' }),
      ).not.toBeInTheDocument();
      expect(
        within(filters).queryByRole('searchbox', { name: 'Subcategory' }),
      ).not.toBeInTheDocument();
      expect(screen.getByRole('list', { name: 'Active filters' })).toHaveTextContent(
        'At least 70% relevance',
      );
    });

    it('shows the recommendations empty state', async () => {
      matchingService.fetchRecommendations.mockResolvedValue(problemPage([]) as never);
      render(
        <WorkspaceProblems
          slug="clean-city"
          scope="relevant"
          mode="recommendations"
          hasCoordinates
        />,
      );
      expect(
        await screen.findByText('No recommended civic opportunities yet.'),
      ).toBeInTheDocument();
    });

    it('lets a manager mark one not relevant, then refreshes the list', async () => {
      matchingService.fetchRecommendations.mockResolvedValue(
        problemPage([recommendationItem()]) as never,
      );
      matchingService.setRecommendationDismissed.mockResolvedValue(undefined);
      render(
        <WorkspaceProblems
          slug="clean-city"
          scope="relevant"
          mode="recommendations"
          hasCoordinates
          canDismiss
        />,
      );

      await userEvent.click(await screen.findByRole('button', { name: /Not relevant/ }));
      expect(matchingService.setRecommendationDismissed).toHaveBeenCalledWith(
        'clean-city',
        'SAM-1023',
        true,
      );
      await waitFor(() =>
        expect(matchingService.fetchRecommendations).toHaveBeenCalledTimes(2),
      );
      // The confirmation toast, beside the tab of the same name.
      expect(await screen.findAllByText('Marked not relevant')).toHaveLength(2);

      await userEvent.click(screen.getByRole('tab', { name: 'Marked not relevant' }));
      expect(routerMock.replace).toHaveBeenCalledWith('/?view=dismissed', {
        scroll: false,
      });
    });

    it('offers no dismissal to a member', async () => {
      matchingService.fetchRecommendations.mockResolvedValue(
        problemPage([recommendationItem()]) as never,
      );
      render(
        <WorkspaceProblems
          slug="clean-city"
          scope="relevant"
          mode="recommendations"
          hasCoordinates
        />,
      );
      await screen.findByText('92% relevance');
      expect(
        screen.queryByRole('button', { name: /Not relevant/ }),
      ).not.toBeInTheDocument();
      expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    });
  });
});
