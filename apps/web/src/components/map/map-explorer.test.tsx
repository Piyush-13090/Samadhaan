import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  GeocodeResult,
  MapAggregateCollection,
  MapProblemCollection,
  MapProblemFeature,
} from '@samadhaan/shared';
import { fakeMap, viewportAround } from '@/test/fake-map';
import { renderWithProviders as render, screen } from '@/test/render';
import { MapExplorer } from './map-explorer';

const { fetchMapProblems, fetchMapAggregate, searchPlaces } = vi.hoisted(() => ({
  fetchMapProblems: vi.fn(),
  fetchMapAggregate: vi.fn(),
  searchPlaces: vi.fn(),
}));

vi.mock('@/services/map.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/map.service')>()),
  fetchMapProblems,
  fetchMapAggregate,
  searchPlaces,
  reverseGeocode: vi.fn(),
}));

function feature(
  publicId: string,
  overrides: Partial<MapProblemFeature['properties']> = {},
): MapProblemFeature {
  return {
    type: 'Feature',
    id: publicId,
    geometry: { type: 'Point', coordinates: [77.0266, 28.4595] },
    properties: {
      publicId,
      title: `Problem ${publicId}`,
      category: 'POTHOLES',
      subcategory: 'Road surface',
      severity: 'HIGH',
      status: 'SUBMITTED',
      area: 'Sector 12',
      city: 'Gurugram',
      voteCount: 4,
      createdAt: '2026-10-01T00:00:00.000Z',
      distanceMeters: null,
      ...overrides,
    },
  };
}

function collection(
  features: MapProblemFeature[],
  truncated = false,
): MapProblemCollection {
  return { type: 'FeatureCollection', features, bbox: [77, 28.4, 77.1, 28.5], truncated };
}

/** A city-scale viewport: individual problems. */
const CITY = viewportAround(28.4595, 77.0266, 0.1, 13);

/** Opens the explorer and settles it on a city viewport. */
async function openOnCity() {
  render(<MapExplorer profileCity={null} />);
  await screen.findByTestId('fake-map');
  fakeMap.moveTo(CITY);
}

beforeEach(() => {
  fakeMap.reset();
  window.localStorage.clear();
});

afterEach(() => vi.clearAllMocks());

describe('MapExplorer', () => {
  it('renders the map, its markers and the same problems as an accessible list', async () => {
    fetchMapProblems.mockResolvedValue(
      collection([feature('SAM-1', { severity: 'CRITICAL' }), feature('SAM-2')]),
    );
    await openOnCity();

    const list = await screen.findByRole('list', { name: 'Problems in this area' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(
      screen.getAllByTestId('map-marker').map((marker) => marker.dataset.severity),
    ).toEqual(['CRITICAL', 'HIGH']);
    // The list is reachable without the map: every row links to its problem.
    expect(within(list).getByRole('link', { name: 'Problem SAM-1' })).toHaveAttribute(
      'href',
      '/problems/SAM-1',
    );
    expect(
      screen.getByRole('region', { name: /Map of civic problems/ }),
    ).toBeInTheDocument();
    expect(screen.getByText('2 shown')).toBeInTheDocument();
  });

  it('opens a popup with civic facts and a link when a marker is chosen', async () => {
    fetchMapProblems.mockResolvedValue(
      collection([
        feature('SAM-1023', {
          title: 'Large pothole near Sector 12 market',
          distanceMeters: 350,
        }),
      ]),
    );
    const user = userEvent.setup();
    await openOnCity();

    await user.click(await screen.findByRole('button', { name: 'Marker SAM-1023' }));

    const popup = screen.getByTestId('map-popup');
    expect(popup).toHaveTextContent('SAM-1023');
    expect(popup).toHaveTextContent('Large pothole near Sector 12 market');
    expect(popup).toHaveTextContent('Potholes · Road surface');
    expect(popup).toHaveTextContent('High severity');
    expect(popup).toHaveTextContent('350 m away');
    expect(within(popup).getByRole('link', { name: 'View problem' })).toHaveAttribute(
      'href',
      '/problems/SAM-1023',
    );
  });

  it('selects from the list, flying the map there', async () => {
    fetchMapProblems.mockResolvedValue(collection([feature('SAM-7')]));
    const user = userEvent.setup();
    await openOnCity();

    await user.click(
      await screen.findByRole('button', { name: /Show on map: Problem SAM-7/ }),
    );

    expect(fakeMap.controller.flyTo).toHaveBeenCalledWith(
      { latitude: 28.4595, longitude: 77.0266 },
      16,
    );
    expect(screen.getByTestId('map-popup')).toHaveTextContent('SAM-7');
    expect(screen.getByRole('button', { name: /Show on map/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('fetches the new viewport when the map settles, debounced', async () => {
    fetchMapProblems.mockResolvedValue(collection([]));
    await openOnCity();
    await waitFor(() => expect(fetchMapProblems).toHaveBeenCalledTimes(1));

    // Three quick movements settle into one request, for the last viewport.
    fakeMap.moveTo(viewportAround(28.5, 77.1));
    fakeMap.moveTo(viewportAround(28.6, 77.2));
    fakeMap.moveTo(viewportAround(28.7, 77.3));

    await waitFor(() => expect(fetchMapProblems).toHaveBeenCalledTimes(2));
    const [bbox] = fetchMapProblems.mock.calls[1]!;
    expect(bbox).toEqual(viewportAround(28.7, 77.3).bbox);
  });

  it('never lets an older response overwrite a newer one', async () => {
    let releaseOld!: (value: MapProblemCollection) => void;
    fetchMapProblems
      .mockImplementationOnce(() => new Promise((resolve) => (releaseOld = resolve)))
      .mockResolvedValueOnce(collection([feature('SAM-NEW')]));
    await openOnCity();
    await waitFor(() => expect(fetchMapProblems).toHaveBeenCalledTimes(1));

    fakeMap.moveTo(viewportAround(28.6, 77.2));
    expect(await screen.findByText('Problem SAM-NEW')).toBeInTheDocument();

    releaseOld(collection([feature('SAM-OLD')]));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByText('Problem SAM-OLD')).not.toBeInTheDocument();
  });

  it('applies filters to the request', async () => {
    fetchMapProblems.mockResolvedValue(collection([]));
    const user = userEvent.setup();
    await openOnCity();
    await waitFor(() => expect(fetchMapProblems).toHaveBeenCalledTimes(1));

    const filters = screen.getAllByRole('group', { name: 'Filter the map' })[0]!;
    await user.click(within(filters).getAllByRole('combobox')[1]!);
    await user.click(await screen.findByRole('option', { name: 'Critical' }));

    await waitFor(() =>
      expect(fetchMapProblems).toHaveBeenLastCalledWith(
        expect.any(Array),
        expect.objectContaining({ severity: 'CRITICAL' }),
        expect.anything(),
      ),
    );
  });

  it('shows a loading state, then an empty state', async () => {
    let release!: (value: MapProblemCollection) => void;
    fetchMapProblems.mockReturnValue(new Promise((resolve) => (release = resolve)));
    await openOnCity();

    expect(await screen.findByLabelText('Loading problems')).toHaveAttribute(
      'aria-busy',
      'true',
    );
    release(collection([]));
    expect(await screen.findByText('No problems in this area')).toBeInTheDocument();
  });

  it('shows an error with retry, and the page stays usable', async () => {
    fetchMapProblems
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(collection([feature('SAM-9')]));
    const user = userEvent.setup();
    await openOnCity();

    expect(
      await screen.findByText("Couldn't load problems for this area"),
    ).toBeInTheDocument();
    // Search and filters remain.
    expect(
      screen.getByRole('combobox', { name: 'Search for a place' }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Problem SAM-9')).toBeInTheDocument();
  });

  it('says when a viewport holds more than is shown', async () => {
    fetchMapProblems.mockResolvedValue(collection([feature('SAM-1')], true));
    await openOnCity();
    expect(await screen.findByText(/Zoom in to see the rest/)).toBeInTheDocument();
  });

  it('switches to aggregated cells when zoomed out, and zooms in on a cell', async () => {
    const cells: MapAggregateCollection = {
      type: 'FeatureCollection',
      bbox: [70, 20, 80, 30],
      cellSizeDegrees: 0.5,
      totalCount: 47,
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [77.03, 28.46] },
          properties: {
            count: 47,
            severity: { LOW: 10, MEDIUM: 20, HIGH: 12, CRITICAL: 5 },
            topCategories: [{ category: 'POTHOLES', count: 20 }],
          },
        },
      ],
    };
    fetchMapAggregate.mockResolvedValue(cells);
    const user = userEvent.setup();
    render(<MapExplorer profileCity={null} />);
    await screen.findByTestId('fake-map');

    fakeMap.moveTo(viewportAround(25, 75, 10, 6));

    expect(
      await screen.findByText('Zoom in to see individual problems'),
    ).toBeInTheDocument();
    expect(screen.getByText(/47 problems across this view/)).toBeInTheDocument();
    expect(fetchMapProblems).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Cell of 47' }));
    expect(fakeMap.controller.flyTo).toHaveBeenCalledWith(
      { latitude: 28.46, longitude: 77.03 },
      9,
    );
  });

  it('asks the user to zoom in rather than searching a hemisphere', async () => {
    render(<MapExplorer profileCity={null} />);
    await screen.findByTestId('fake-map');

    fakeMap.moveTo(viewportAround(0, 0, 120, 1));

    expect(await screen.findByText(/too wide to search/)).toBeInTheDocument();
    expect(fetchMapProblems).not.toHaveBeenCalled();
    expect(fetchMapAggregate).not.toHaveBeenCalled();
  });

  it('jumps to a searched place', async () => {
    const place: GeocodeResult = {
      label: 'Gurugram, Haryana, India',
      latitude: 28.46,
      longitude: 77.03,
      address: null,
      city: 'Gurugram',
      state: 'Haryana',
      postalCode: null,
      country: 'India',
      boundingBox: [76.9, 28.3, 77.2, 28.6],
    };
    searchPlaces.mockResolvedValue([place]);
    fetchMapProblems.mockResolvedValue(collection([]));
    const user = userEvent.setup();
    render(<MapExplorer profileCity={null} />);
    await screen.findByTestId('fake-map');

    await user.type(
      screen.getByRole('combobox', { name: 'Search for a place' }),
      'Gurugram',
    );
    await user.click(await screen.findByRole('option', { name: /Gurugram, Haryana/ }));

    expect(fakeMap.controller.fitBounds).toHaveBeenCalledWith([76.9, 28.3, 77.2, 28.6]);
  });

  it('opens on the profile city when no location has been shared', async () => {
    searchPlaces.mockResolvedValue([
      {
        label: 'Gurugram',
        latitude: 28.46,
        longitude: 77.03,
        address: null,
        city: 'Gurugram',
        state: null,
        postalCode: null,
        country: null,
        boundingBox: [76.9, 28.3, 77.2, 28.6],
      },
    ]);
    render(<MapExplorer profileCity="Gurugram" />);

    await waitFor(() => expect(fakeMap.controller.fitBounds).toHaveBeenCalled());
    expect(searchPlaces).toHaveBeenCalledWith('Gurugram');
  });

  it('asks for location only when the user taps the control, and copes with denial', async () => {
    const getCurrentPosition = vi.fn(
      (_ok: PositionCallback, fail?: PositionErrorCallback) =>
        fail?.({
          code: 1,
          message: 'denied',
          PERMISSION_DENIED: 1,
        } as GeolocationPositionError),
    );
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition },
    });
    fetchMapProblems.mockResolvedValue(collection([]));
    const user = userEvent.setup();
    await openOnCity();

    expect(getCurrentPosition).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Use my location' }));

    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Couldn't use your location")).toBeInTheDocument();
    expect(
      screen.getByText(/Search for a place or move the map instead/),
    ).toBeInTheDocument();
  });

  it('measures distances from a shared location, and shows it on the map', async () => {
    window.localStorage.setItem(
      'samadhaan.discovery.location',
      JSON.stringify({ latitude: 28.4595, longitude: 77.0266, savedAt: Date.now() }),
    );
    fetchMapProblems.mockResolvedValue(
      collection([feature('SAM-1', { distanceMeters: 120 })]),
    );
    render(<MapExplorer profileCity={null} />);
    await screen.findByTestId('fake-map');
    fakeMap.moveTo(CITY);

    expect(await screen.findByText('120 m away')).toBeInTheDocument();
    expect(screen.getByTestId('map-user-location')).toBeInTheDocument();
    expect(fetchMapProblems.mock.calls.at(-1)![2]).toMatchObject({
      origin: { latitude: 28.4595, longitude: 77.0266 },
    });
  });

  it('keeps the map useful on a phone: map first, filters in a drawer', async () => {
    fetchMapProblems.mockResolvedValue(collection([]));
    await openOnCity();

    const mapBox = screen.getByTestId('fake-map').closest('.order-1');
    expect(mapBox?.className).toContain('h-[55dvh]');
    expect(
      screen.getByRole('button', { name: /^Filters/ }).closest('.md\\:hidden'),
    ).not.toBeNull();
  });
});
