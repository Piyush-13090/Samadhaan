import { act } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import userEvent from '@testing-library/user-event';
import { SEVERITY_MARKERS, SEVERITY_ORDER } from '@/lib/map/severity-markers';
import { fakeMap } from '@/test/fake-map';
import { renderWithProviders as render, screen } from '@/test/render';
import { CivicMap } from './civic-map';
import { MapLegend } from './map-legend';
import {
  PROBLEM_CLUSTER_COUNT_LAYER,
  PROBLEM_CLUSTER_LAYER,
  PROBLEM_MARKER_LAYER,
  PROBLEM_SOURCE,
} from './problem-layers';

beforeEach(() => fakeMap.reset());

describe('CivicMap', () => {
  it('renders the configured provider as a labelled region', async () => {
    render(
      <CivicMap
        label="Test map"
        initialCenter={{ latitude: 28, longitude: 77 }}
        initialZoom={12}
      />,
    );
    expect(await screen.findByRole('region', { name: 'Test map' })).toBeInTheDocument();
  });

  it('replaces a failed map with an explanation and a retry, never a blank box', async () => {
    const user = userEvent.setup();
    render(
      <CivicMap
        label="Test map"
        initialCenter={{ latitude: 28, longitude: 77 }}
        initialZoom={12}
        fallbackHint="Problems are listed alongside."
      />,
    );
    await screen.findByTestId('fake-map');

    act(() => fakeMap.props?.onError?.('Your browser could not display the map.'));

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Your browser could not display the map.',
    );
    expect(screen.getByText('Problems are listed alongside.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByTestId('fake-map')).toBeInTheDocument();
  });
});

describe('map layers', () => {
  it('clusters problems in the provider, not as DOM markers', () => {
    expect(PROBLEM_SOURCE).toMatchObject({
      type: 'geojson',
      cluster: true,
      promoteId: 'publicId',
    });
    expect(PROBLEM_SOURCE.clusterMaxZoom).toBeGreaterThanOrEqual(14);
    expect(PROBLEM_CLUSTER_LAYER.filter).toEqual(['has', 'point_count']);
    expect(PROBLEM_CLUSTER_COUNT_LAYER.layout?.['text-field']).toEqual([
      'get',
      'point_count_abbreviated',
    ]);
  });

  it('draws individual problems by severity shape, most severe on top', () => {
    expect(PROBLEM_MARKER_LAYER.filter).toEqual(['!', ['has', 'point_count']]);
    const image = JSON.stringify(PROBLEM_MARKER_LAYER.layout?.['icon-image']);
    for (const severity of SEVERITY_ORDER) {
      expect(image).toContain(SEVERITY_MARKERS[severity].icon);
    }
  });

  it('gives every severity its own shape, so colour is never the only signal', () => {
    const paths = SEVERITY_ORDER.map((severity) => SEVERITY_MARKERS[severity].path);
    expect(new Set(paths).size).toBe(SEVERITY_ORDER.length);
  });
});

describe('MapLegend', () => {
  it('explains each severity in words alongside its shape', () => {
    render(<MapLegend />);
    const legend = screen.getByRole('region', { name: 'Map legend' });
    for (const label of [
      'Low',
      'Medium',
      'High',
      'Critical',
      'Group of nearby problems',
    ]) {
      expect(legend).toHaveTextContent(label);
    }
    // The shapes are decorative; the words carry the meaning.
    for (const svg of legend.querySelectorAll('svg')) {
      expect(svg).toHaveAttribute('aria-hidden', 'true');
    }
  });
});
