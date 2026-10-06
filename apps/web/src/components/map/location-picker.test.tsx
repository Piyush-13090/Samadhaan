import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import type { GeocodeResult } from '@samadhaan/shared';
import { fakeMap } from '@/test/fake-map';
import { renderWithProviders as render, screen } from '@/test/render';
import { LocationPicker } from './location-picker';

const { reverseGeocode } = vi.hoisted(() => ({ reverseGeocode: vi.fn() }));
vi.mock('@/services/map.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/map.service')>()),
  reverseGeocode,
  searchPlaces: vi.fn(),
}));

const PLACE: GeocodeResult = {
  label: '12 Market Road, Sector 12, Gurugram, Haryana',
  latitude: 28.4595,
  longitude: 77.0266,
  address: '12 Market Road, Sector 12',
  city: 'Gurugram',
  state: 'Haryana',
  postalCode: '122001',
  country: 'India',
  boundingBox: null,
};

beforeEach(() => fakeMap.reset());
afterEach(() => vi.clearAllMocks());

describe('LocationPicker', () => {
  it('prompts for a place before one is chosen', async () => {
    render(<LocationPicker value={null} onChange={vi.fn()} onUseAddress={vi.fn()} />);
    await screen.findByTestId('fake-map');
    expect(screen.getByText(/tap the map where the problem is/)).toBeInTheDocument();
    expect(screen.queryByTestId('map-pin')).not.toBeInTheDocument();
  });

  it('shows a pin, reports moves, and offers the address it finds without imposing it', async () => {
    reverseGeocode.mockResolvedValue(PLACE);
    const onChange = vi.fn();
    const onUseAddress = vi.fn();
    const user = userEvent.setup();
    render(
      <LocationPicker
        value={{ latitude: 28.4595, longitude: 77.0266 }}
        onChange={onChange}
        onUseAddress={onUseAddress}
      />,
    );

    expect(await screen.findByTestId('map-pin')).toHaveTextContent('28.4595,77.0266');
    expect(await screen.findByText(PLACE.label)).toBeInTheDocument();
    expect(onUseAddress).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Use this address' }));
    expect(onUseAddress).toHaveBeenCalledWith(PLACE);

    // Dragging the pin (the fake drops it at a fixed point).
    await user.click(screen.getByTestId('map-pin'));
    expect(onChange).toHaveBeenCalledWith({ latitude: 12.5, longitude: 77.5 });
  });

  it('keeps the pin and asks for a landmark when no address is found', async () => {
    reverseGeocode.mockRejectedValue(new Error('geocoder down'));
    render(
      <LocationPicker
        value={{ latitude: 28.4595, longitude: 77.0266 }}
        onChange={vi.fn()}
        onUseAddress={vi.fn()}
      />,
    );

    expect(await screen.findByText(/couldn't find an address here/)).toBeInTheDocument();
    expect(screen.getByTestId('map-pin')).toBeInTheDocument();
  });

  it('centres the map on a pin set from outside', async () => {
    reverseGeocode.mockResolvedValue(null);
    render(
      <LocationPicker
        value={{ latitude: 28.4595, longitude: 77.0266 }}
        onChange={vi.fn()}
        onUseAddress={vi.fn()}
      />,
    );
    await screen.findByTestId('fake-map');
    expect(fakeMap.controller.flyTo).toHaveBeenCalledWith(
      { latitude: 28.4595, longitude: 77.0266 },
      expect.any(Number),
    );
  });
});
