import { beforeEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PaginatedData, ProblemListItem } from '@samadhaan/shared';
import { renderWithProviders as render, screen } from '@/test/render';
import { MyProblemsList } from './my-problems-list';

const { fetchMyProblems } = vi.hoisted(() => ({ fetchMyProblems: vi.fn() }));
vi.mock('@/services/discovery.service', () => ({ fetchMyProblems }));

function item(overrides: Partial<ProblemListItem> = {}): ProblemListItem {
  return {
    publicId: 'SAM-1023',
    title: 'Large pothole near Sector 12 market',
    category: 'POTHOLES',
    subcategory: 'Road surface failure',
    status: 'UNDER_REVIEW',
    severity: 'HIGH',
    urgency: 'HIGH',
    area: 'Main Market Crossing',
    city: 'Gurugram',
    distanceMeters: null,
    voteCount: 214,
    commentCount: 3,
    thumbnailUrl: null,
    createdAt: '2026-09-10T00:00:00.000Z',
    hasAiAnalysis: true,
    isOwnReport: true,
    ...overrides,
  };
}

function page(
  overrides: Partial<PaginatedData<ProblemListItem>> = {},
): PaginatedData<ProblemListItem> {
  return { items: [item()], nextCursor: null, totalCount: 1, ...overrides };
}

describe('MyProblemsList', () => {
  beforeEach(() => {
    fetchMyProblems.mockReset();
  });

  it('renders the server-rendered first page without refetching', () => {
    render(<MyProblemsList initial={page()} />);

    expect(screen.getByText('SAM-1023')).toBeInTheDocument();
    expect(fetchMyProblems).not.toHaveBeenCalled();
  });

  it('prompts a citizen who has reported nothing', () => {
    render(<MyProblemsList initial={page({ items: [], totalCount: 0 })} />);

    expect(screen.getByText(/You haven't reported any problems yet/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Report a problem/i })).toHaveAttribute(
      'href',
      '/report',
    );
  });

  it('filters by status', async () => {
    const user = userEvent.setup();
    fetchMyProblems.mockResolvedValue(page());

    render(<MyProblemsList initial={page()} />);

    await user.click(screen.getByRole('combobox', { name: /Status/i }));
    await user.click(await screen.findByRole('option', { name: 'Resolved' }));

    await waitFor(() =>
      expect(fetchMyProblems).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: 'RESOLVED' }),
      ),
    );
  });

  it('changes the sort order', async () => {
    const user = userEvent.setup();
    fetchMyProblems.mockResolvedValue(page());

    render(<MyProblemsList initial={page()} />);

    await user.click(screen.getByRole('combobox', { name: /Sort/i }));
    await user.click(await screen.findByRole('option', { name: 'Oldest first' }));

    await waitFor(() =>
      expect(fetchMyProblems).toHaveBeenLastCalledWith(
        expect.objectContaining({ sort: 'oldest' }),
      ),
    );
  });

  it('distinguishes an empty account from an empty filter result', async () => {
    const user = userEvent.setup();
    fetchMyProblems.mockResolvedValue(page({ items: [], totalCount: 0 }));

    render(<MyProblemsList initial={page()} />);

    await user.click(screen.getByRole('combobox', { name: /Status/i }));
    await user.click(await screen.findByRole('option', { name: 'Resolved' }));

    expect(await screen.findByText('No reports match these filters')).toBeInTheDocument();
    expect(
      screen.queryByText(/You haven't reported any problems yet/),
    ).not.toBeInTheDocument();
  });

  it('appends the next page rather than replacing the list', async () => {
    const user = userEvent.setup();
    fetchMyProblems.mockResolvedValue(
      page({ items: [item({ publicId: 'SAM-2000', title: 'A second report' })] }),
    );

    render(
      <MyProblemsList initial={page({ nextCursor: 'cursor-1', totalCount: 2 })} />,
    );

    await user.click(screen.getByRole('button', { name: /Load more/i }));

    expect(await screen.findByText('SAM-2000')).toBeInTheDocument();
    expect(screen.getByText('SAM-1023')).toBeInTheDocument();
    expect(fetchMyProblems).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: 'cursor-1' }),
    );
  });

  it('offers Load more only when another page exists', () => {
    render(<MyProblemsList initial={page()} />);

    expect(screen.queryByRole('button', { name: /Load more/i })).not.toBeInTheDocument();
  });

  it('recovers from a failed reload', async () => {
    const user = userEvent.setup();
    fetchMyProblems.mockRejectedValueOnce(new Error('network down'));

    render(<MyProblemsList initial={page()} />);

    await user.click(screen.getByRole('combobox', { name: /Status/i }));
    await user.click(await screen.findByRole('option', { name: 'Resolved' }));

    expect(await screen.findByText(/Couldn't load your reports/)).toBeInTheDocument();

    fetchMyProblems.mockResolvedValue(page());
    await user.click(screen.getByRole('button', { name: /Try again/i }));

    expect(await screen.findByText('SAM-1023')).toBeInTheDocument();
  });

  /**
   * A list that cannot load is a section-level failure. The page around it
   * still works, and the list offers a way to retry rather than the whole
   * route falling to an error boundary.
   */
  it('shows a retryable error when the server could not be reached', async () => {
    const user = userEvent.setup();
    render(<MyProblemsList initial={null} />);

    expect(
      screen.getByText(/Samadhaan could not reach the server/),
    ).toBeInTheDocument();

    fetchMyProblems.mockResolvedValue(page());
    await user.click(screen.getByRole('button', { name: /Try again/i }));

    expect(await screen.findByText('SAM-1023')).toBeInTheDocument();
  });

  it('labels the filter group for assistive technology', () => {
    render(<MyProblemsList initial={page()} />);

    expect(screen.getByRole('group', { name: 'Filter your reports' })).toBeInTheDocument();
  });
});
