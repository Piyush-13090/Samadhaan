import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MapProblemFeature } from '@samadhaan/shared';
import { fakeMap, viewportAround } from '@/test/fake-map';
import { renderWithProviders as render, screen, within } from '@/test/render';
import { GovernmentMap } from './government-map';

const fetchMapProblems = vi.hoisted(() => vi.fn());
vi.mock('@/services/map.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/map.service')>()),
  fetchMapProblems,
}));

const feature = (publicId: string): MapProblemFeature => ({
  type: 'Feature',
  id: publicId,
  geometry: { type: 'Point', coordinates: [77.04, 28.42] },
  properties: {
    publicId,
    title: `Problem ${publicId}`,
    category: 'POTHOLES',
    subcategory: null,
    severity: 'HIGH',
    status: 'UNDER_REVIEW',
    area: 'Sector 48',
    city: 'Gurugram',
    voteCount: 3,
    createdAt: '2026-10-01T00:00:00.000Z',
    distanceMeters: null,
  },
});

describe('GovernmentMap', () => {
  beforeEach(() => fakeMap.reset());

  it('loads from the jurisdiction-scoped endpoint and opens on the jurisdiction', async () => {
    fetchMapProblems.mockResolvedValue({
      type: 'FeatureCollection',
      features: [feature('SAM-1023')],
      bbox: [77, 28.4, 77.1, 28.5],
      truncated: false,
    });
    render(
      <GovernmentMap
        slug="gurgaon-mc"
        initialView={null}
        bounds={[76.93, 28.36, 77.15, 28.54]}
      />,
    );
    await screen.findByTestId('fake-map');

    expect(fakeMap.controller.fitBounds).toHaveBeenCalledWith([
      76.93, 28.36, 77.15, 28.54,
    ]);

    fakeMap.moveTo(viewportAround(28.42, 77.04, 0.1, 13));
    const list = await screen.findByRole('list', { name: 'Problems in this area' });

    expect(fetchMapProblems).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(Object),
      expect.objectContaining({
        source: {
          problems: '/government/gurgaon-mc/map',
          aggregate: '/government/gurgaon-mc/map/aggregate',
        },
      }),
    );
    // The list links to the review page, not the public page.
    expect(within(list).getByRole('link', { name: 'Problem SAM-1023' })).toHaveAttribute(
      'href',
      '/government/gurgaon-mc/problems/SAM-1023',
    );

    // List and map stay in step.
    await userEvent.click(within(list).getByRole('button', { name: /Show on map/ }));
    expect(fakeMap.props?.selectedId).toBe('SAM-1023');
  });

  it('offers review filters, including statuses citizens never see', async () => {
    fetchMapProblems.mockResolvedValue({
      type: 'FeatureCollection',
      features: [],
      bbox: [0, 0, 1, 1],
      truncated: false,
    });
    render(<GovernmentMap slug="gurgaon-mc" initialView={null} bounds={null} />);
    const filters = screen.getAllByRole('group', { name: 'Filter the map' })[0]!;
    expect(
      within(filters).getByRole('combobox', { name: 'Duplicates' }),
    ).toBeInTheDocument();
    expect(
      within(filters).getByRole('combobox', { name: 'AI analysis' }),
    ).toBeInTheDocument();
    await userEvent.click(within(filters).getByRole('combobox', { name: 'Status' }));
    expect(await screen.findByRole('option', { name: 'Rejected' })).toBeInTheDocument();
  });
});
