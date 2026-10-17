import userEvent from '@testing-library/user-event';
import type {
  ProblemSearchResult,
  SearchPage as SearchPageData,
  SearchUnderstanding,
  UnifiedSearchResponse,
} from '@samadhaan/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders, screen, waitFor, within } from '@/test/render';
import {
  activeFilterCount,
  readSearchState,
  searchQueryString,
  sortOptions,
} from '@/lib/search';
import { routerMock, searchParamsMock } from '../../../vitest.setup';
import { GlobalSearch } from './global-search';
import { SearchPage } from './search-page';
import { Highlighted } from './search-result-card';

const service = vi.hoisted(() => ({
  searchAll: vi.fn(),
  searchProblems: vi.fn(),
  searchOrganizations: vi.fn(),
  searchKnowledge: vi.fn(),
  searchProjects: vi.fn(),
  fetchSuggestions: vi.fn(),
  fetchRecentSearches: vi.fn(),
  clearRecentSearches: vi.fn(),
}));
vi.mock('@/services/search.service', () => service);
const auth = vi.hoisted(() => ({ role: 'CITIZEN' }));
vi.mock('@/components/auth/auth-provider', () => ({
  useAuth: () => ({ user: { role: auth.role } }),
}));

const problem = (
  id: string,
  title = 'Blocked drain near Sector 12',
): ProblemSearchResult => ({
  type: 'PROBLEM',
  id,
  title,
  subtitle: 'Drainage · Gurugram',
  href: `/problems/${id}`,
  score: 0.8,
  highlights: [
    {
      field: 'title',
      segments: title
        .split(/(drain)/)
        .filter(Boolean)
        .map((text) => ({ text, match: text === 'drain' })),
    },
  ],
  explanation: ['Matches your words', 'Similar in meaning'],
  metadata: {
    category: 'DRAINAGE',
    subcategory: null,
    status: 'VERIFIED',
    severity: 'HIGH',
    urgency: 'HIGH',
    priority: null,
    city: 'Gurugram',
    state: null,
    voteCount: 4,
    createdAt: '2026-10-07T00:00:00.000Z',
    distanceKm: null,
  },
});

const page = <T extends ProblemSearchResult>(
  items: T[],
  overrides: Partial<SearchPageData<T>> = {},
): SearchPageData<T> => ({
  items,
  nextCursor: null,
  total: items.length,
  match: 'exact',
  understanding: null,
  signals: ['keyword', 'semantic'],
  ...overrides,
});

const understanding: SearchUnderstanding = {
  intent: 'SEARCH_PROBLEMS',
  entityType: 'PROBLEM',
  applied: [
    { filter: 'category', value: 'DRAINAGE', label: 'Drainage' },
    { filter: 'severity', value: 'CRITICAL', label: 'Critical' },
  ],
  text: '',
  needsLocation: false,
  source: 'rules',
  confidence: 0.9,
};

const unified = (
  overrides: Partial<UnifiedSearchResponse> = {},
): UnifiedSearchResponse => ({
  query: 'drain',
  understanding,
  problems: page([problem('SAM-1')]),
  organizations: { ...page([]), items: [] } as never,
  knowledge: { ...page([]), items: [] } as never,
  projects: null,
  ...overrides,
});

const setUrl = (query: string) => {
  for (const key of [...searchParamsMock.keys()]) searchParamsMock.delete(key);
  for (const [k, v] of new URLSearchParams(query)) searchParamsMock.set(k, v);
};

beforeEach(() => {
  vi.clearAllMocks();
  auth.role = 'CITIZEN';
  service.fetchRecentSearches.mockResolvedValue({ items: ['road issues Gurgaon'] });
  service.clearRecentSearches.mockResolvedValue(undefined);
});
afterEach(() => setUrl(''));

describe('search URL state', () => {
  it('drops invalid values and round-trips valid ones', () => {
    const state = readSearchState(
      new URLSearchParams(
        'q=drain&type=PROBLEM&category=DRAINAGE&severity=NOPE&from=bad&sort=nearest',
      ),
    );
    expect(state).toMatchObject({
      q: 'drain',
      type: 'PROBLEM',
      category: 'DRAINAGE',
      sort: 'nearest',
    });
    expect(state.severity).toBeUndefined();
    expect(state.from).toBeUndefined();
    expect(searchQueryString(state)).toBe(
      '?q=drain&type=PROBLEM&sort=nearest&category=DRAINAGE',
    );
    expect(activeFilterCount(state)).toBe(1);
  });

  it('offers "nearest" only with a location', () => {
    const without = readSearchState(new URLSearchParams('q=drain'));
    expect(sortOptions(without).map((o) => o.value)).not.toContain('nearest');
    const withPlace = readSearchState(new URLSearchParams('q=drain&lat=18.5&lng=73.8'));
    expect(sortOptions(withPlace).map((o) => o.value)).toContain('nearest');
  });
});

describe('Highlighted', () => {
  it('marks matches as text and never renders HTML', () => {
    renderWithProviders(
      <p>
        <Highlighted
          fallback=""
          segments={[
            { text: '<img src=x onerror=alert(1)> ', match: false },
            { text: 'drain', match: true },
          ]}
        />
      </p>,
    );
    expect(screen.getByText('drain').tagName).toBe('MARK');
    expect(document.querySelector('img')).toBeNull();
    expect(screen.getByText(/<img src=x/)).toBeInTheDocument();
  });
});

describe('GlobalSearch', () => {
  it('is a combobox with grouped suggestions and keyboard selection', async () => {
    service.fetchSuggestions.mockResolvedValue({
      query: 'dra',
      suggestions: [
        {
          kind: 'CATEGORY',
          label: 'Drainage problems',
          href: '/search?type=PROBLEM&category=DRAINAGE',
          detail: 'Category',
        },
        {
          kind: 'PROBLEM',
          label: 'Blocked drain near Sector 12',
          href: '/problems/SAM-1',
          detail: 'SAM-1',
        },
        {
          kind: 'ORGANIZATION',
          label: 'Clean Water NGO',
          href: '/organizations/clean-water',
          detail: 'Ngo',
        },
      ],
    });
    renderWithProviders(<GlobalSearch />);
    const box = screen.getByRole('combobox', { name: 'Search Samadhaan' });
    await userEvent.type(box, 'dra');
    const problems = await screen.findByRole('group', { name: 'Problems' });
    const list = screen.getByRole('listbox', { name: 'Search suggestions' });
    expect(problems).toHaveTextContent('Blocked drain near Sector 12');
    expect(
      within(list).getByRole('group', { name: 'Organisations' }),
    ).toBeInTheDocument();
    expect(service.fetchSuggestions).toHaveBeenLastCalledWith(
      'dra',
      expect.any(AbortSignal),
    );

    await userEvent.keyboard('{ArrowDown}{ArrowDown}');
    const active = screen.getByRole('option', { selected: true });
    expect(active).toHaveTextContent('Blocked drain near Sector 12');
    expect(box).toHaveAttribute('aria-activedescendant', active.id);
    await userEvent.keyboard('{Enter}');
    expect(routerMock.push).toHaveBeenCalledWith('/problems/SAM-1');
  });

  it('waits for two characters, then searches the text on Enter', async () => {
    service.fetchSuggestions.mockResolvedValue({ query: 'potholes', suggestions: [] });
    renderWithProviders(<GlobalSearch />);
    const box = screen.getByRole('combobox');
    await userEvent.type(box, 'p');
    expect(service.fetchSuggestions).not.toHaveBeenCalled();
    await userEvent.type(box, 'otholes{Enter}');
    expect(routerMock.push).toHaveBeenCalledWith('/search?q=potholes');
  });

  it('shows and clears recent searches, focuses with Ctrl+K, closes with Escape', async () => {
    renderWithProviders(<GlobalSearch />);
    await userEvent.keyboard('{Control>}k{/Control}');
    const box = screen.getByRole('combobox');
    expect(box).toHaveFocus();
    const recent = await screen.findByRole('group', { name: 'Recent searches' });
    expect(recent).toHaveTextContent('road issues Gurgaon');
    await userEvent.click(within(recent).getByRole('button', { name: 'Clear' }));
    expect(service.clearRecentSearches).toHaveBeenCalled();
    await userEvent.keyboard('{Escape}');
    expect(box).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('SearchPage', () => {
  it('searches everything from the URL and shows how the words were read', async () => {
    setUrl('q=critical drainage problems');
    service.searchAll.mockResolvedValue(unified());
    renderWithProviders(<SearchPage />);
    expect(
      await screen.findByRole('link', { name: 'Blocked drain near Sector 12' }),
    ).toHaveAttribute('href', '/problems/SAM-1');
    expect(service.searchAll).toHaveBeenCalledWith(
      expect.objectContaining({ q: 'critical drainage problems' }),
      expect.any(AbortSignal),
    );
    const read = screen.getByLabelText('How your search was read');
    expect(read).toHaveTextContent('Drainage');
    expect(read).toHaveTextContent('Critical');
    expect(screen.getByRole('status')).toHaveTextContent('1 results');
    expect(
      screen.getByText('Matches your words · Similar in meaning'),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: 'Search the exact words instead' }),
    );
    expect(routerMock.push).toHaveBeenCalledWith(
      expect.stringContaining('interpret=false'),
      { scroll: false },
    );
  });

  it('hides the projects tab from citizens', async () => {
    setUrl('q=drain');
    service.searchAll.mockResolvedValue(unified());
    renderWithProviders(<SearchPage />);
    await screen.findByRole('tablist', { name: 'Result type' });
    expect(screen.queryByRole('tab', { name: 'Projects' })).not.toBeInTheDocument();
    auth.role = 'NGO';
  });

  it('says plainly when nothing matched, and when only related results exist', async () => {
    setUrl('q=drainage issue near Sector 99');
    service.searchAll.mockResolvedValue(
      unified({ problems: page([]), understanding: null }),
    );
    const { unmount } = renderWithProviders(<SearchPage />);
    expect(
      await screen.findByText('No results found for “drainage issue near Sector 99”'),
    ).toBeInTheDocument();
    expect(screen.getByText('removing a filter')).toBeInTheDocument();
    unmount();

    setUrl('q=water on roads&type=PROBLEM');
    service.searchProblems.mockResolvedValue(
      page([problem('SAM-2')], { match: 'related' }),
    );
    renderWithProviders(<SearchPage />);
    expect(
      await screen.findByText('No exact matches, but these may be relevant.'),
    ).toBeInTheDocument();
  });

  it('pages with the server cursor and puts filters in the URL', async () => {
    setUrl('q=drain&type=PROBLEM&category=DRAINAGE');
    service.searchProblems
      .mockResolvedValueOnce(page([problem('SAM-1')], { nextCursor: 'c1' }))
      .mockResolvedValueOnce(page([problem('SAM-2', 'Second drain')]));
    renderWithProviders(<SearchPage />);
    await screen.findByRole('link', { name: 'Blocked drain near Sector 12' });
    expect(service.searchProblems).toHaveBeenCalledWith(
      expect.objectContaining({ q: 'drain', category: 'DRAINAGE' }),
      expect.any(AbortSignal),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await screen.findByRole('link', { name: 'Second drain' });
    expect(service.searchProblems).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: 'c1' }),
    );
    expect(screen.getByRole('button', { name: 'Filters (1)' })).toBeInTheDocument();

    const filters = screen.getByRole('form', { name: 'Search filters' });
    await userEvent.selectOptions(within(filters).getByLabelText('Severity'), 'CRITICAL');
    await waitFor(() =>
      expect(routerMock.push).toHaveBeenCalledWith(
        expect.stringContaining('severity=CRITICAL'),
        { scroll: false },
      ),
    );
  });

  it('asks for two characters before searching everything', () => {
    setUrl('q=a');
    renderWithProviders(<SearchPage />);
    expect(screen.getByText(/Type at least 2 characters/)).toBeInTheDocument();
    expect(service.searchAll).not.toHaveBeenCalled();
  });
});
