import { describe, expect, it, vi } from 'vitest';
import type { GeocodingConfig } from '../config/app.config.js';
import {
  GeocodingUnavailableError,
  NominatimGeocodingProvider,
  toResult,
} from './geocoding.provider.js';

const config: GeocodingConfig = {
  provider: 'nominatim',
  baseUrl: 'https://geocoder.test',
  apiKey: null,
  userAgent: 'Samadhaan-test',
  countryCodes: ['in'],
  timeoutMs: 1000,
};

const PLACE = {
  lat: '28.4595',
  lon: '77.0266',
  display_name: 'Sector 12, Gurugram, Haryana, 122001, India',
  boundingbox: ['28.45', '28.47', '77.01', '77.04'] as [string, string, string, string],
  address: {
    road: 'Market Road',
    house_number: '12',
    suburb: 'Sector 12',
    city: 'Gurugram',
    state: 'Haryana',
    postcode: '122001',
    country: 'India',
  },
};

describe('toResult', () => {
  it('maps a Nominatim place, reordering its bounding box to [w, s, e, n]', () => {
    expect(toResult(PLACE)).toEqual({
      label: 'Sector 12, Gurugram, Haryana, 122001, India',
      latitude: 28.4595,
      longitude: 77.0266,
      address: '12 Market Road, Sector 12',
      city: 'Gurugram',
      state: 'Haryana',
      postalCode: '122001',
      country: 'India',
      boundingBox: [77.01, 28.45, 77.04, 28.47],
    });
  });

  it('falls back from city to town and village', () => {
    expect(toResult({ ...PLACE, address: { town: 'Sohna' } })?.city).toBe('Sohna');
    expect(toResult({ ...PLACE, address: { village: 'Badshahpur' } })?.city).toBe(
      'Badshahpur',
    );
  });

  it('rejects impossible coordinates rather than passing them on', () => {
    expect(toResult({ ...PLACE, lat: '123' })).toBeNull();
    expect(toResult({ ...PLACE, lon: 'abc' })).toBeNull();
  });

  it('drops a malformed bounding box', () => {
    expect(
      toResult({ ...PLACE, boundingbox: ['x', '1', '2', '3'] })?.boundingBox,
    ).toBeNull();
  });
});

describe('NominatimGeocodingProvider', () => {
  const ok = (body: unknown) =>
    Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));

  it('sends the configured User-Agent and country restriction', async () => {
    const fetchImpl = vi.fn(() => ok([PLACE]));
    const provider = new NominatimGeocodingProvider(
      config,
      fetchImpl as unknown as typeof fetch,
      0,
    );

    const results = await provider.search('sector 12', 5);

    expect(results).toHaveLength(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('https://geocoder.test/search?');
    expect(url).toContain('countrycodes=in');
    expect((init.headers as Record<string, string>)['user-agent']).toBe('Samadhaan-test');
  });

  it('treats "nothing here" as no result, not an error', async () => {
    const provider = new NominatimGeocodingProvider(
      config,
      (() => ok({ error: 'Unable to geocode' })) as unknown as typeof fetch,
      0,
    );
    await expect(provider.reverse(0, 0)).resolves.toBeNull();
  });

  it('reports an upstream failure as unavailable', async () => {
    const provider = new NominatimGeocodingProvider(
      config,
      (() =>
        Promise.resolve(
          new Response('busy', { status: 503 }),
        )) as unknown as typeof fetch,
      0,
    );
    await expect(provider.search('x', 1)).rejects.toBeInstanceOf(
      GeocodingUnavailableError,
    );
  });

  it('spaces requests to respect the provider’s rate limit', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(() => ok([]));
    const provider = new NominatimGeocodingProvider(
      config,
      fetchImpl as unknown as typeof fetch,
      1000,
    );

    const first = provider.search('a', 1);
    const second = provider.search('b', 1);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    await Promise.all([first, second]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
