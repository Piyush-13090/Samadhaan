import type { BoundingBox, GeocodeResult } from '@samadhaan/shared';
import type { GeocodingConfig } from '../config/app.config.js';

/**
 * A geocoder. Search turns text into places; reverse turns a point into an
 * address.
 *
 * The abstraction the rest of the API depends on. Swapping Nominatim for a
 * commercial geocoder is a new class implementing this, selected by
 * `GEOCODING_PROVIDER` — no caller changes, and the browser never knows.
 */
export abstract class GeocodingProvider {
  abstract readonly name: string;
  abstract search(query: string, limit: number): Promise<GeocodeResult[]>;
  abstract reverse(latitude: number, longitude: number): Promise<GeocodeResult | null>;
}

/** Raised for any provider failure; the service maps it to a 503. */
export class GeocodingUnavailableError extends Error {}

/** The subset of a Nominatim `jsonv2` result this adapter reads. */
interface NominatimPlace {
  lat: string;
  lon: string;
  display_name?: string;
  name?: string;
  boundingbox?: [string, string, string, string];
  address?: Record<string, string | undefined>;
}

/**
 * Nominatim (OpenStreetMap) — or any server speaking its API.
 *
 * The public instance's usage policy asks for at most one request a second, an
 * identifying User-Agent and caching of results. All three are honoured: the
 * gate below spaces requests within this process, the User-Agent comes from
 * config, and `GeocodingService` caches in Redis. Production should point
 * `GEOCODING_BASE_URL` at a self-hosted or commercial instance.
 */
export class NominatimGeocodingProvider extends GeocodingProvider {
  readonly name = 'nominatim';
  private nextSlot = 0;

  constructor(
    private readonly config: GeocodingConfig,
    private readonly fetchImpl: typeof fetch = fetch,
    /** Minimum spacing between upstream calls, in ms. */
    private readonly minIntervalMs = 1000,
  ) {
    super();
  }

  async search(query: string, limit: number): Promise<GeocodeResult[]> {
    const params = new URLSearchParams({
      q: query,
      format: 'jsonv2',
      addressdetails: '1',
      limit: String(limit),
    });
    if (this.config.countryCodes.length > 0) {
      params.set('countrycodes', this.config.countryCodes.join(','));
    }

    const places = await this.request<NominatimPlace[]>(`/search?${params.toString()}`);
    return Array.isArray(places) ? places.map(toResult).filter(isDefined) : [];
  }

  async reverse(latitude: number, longitude: number): Promise<GeocodeResult | null> {
    const params = new URLSearchParams({
      lat: String(latitude),
      lon: String(longitude),
      format: 'jsonv2',
      addressdetails: '1',
      zoom: '18',
    });

    const place = await this.request<NominatimPlace & { error?: string }>(
      `/reverse?${params.toString()}`,
    );
    // Nominatim answers "nothing here" (open sea) with 200 and an `error` key.
    if (!place || place.error) return null;
    return toResult(place);
  }

  private async request<T>(path: string): Promise<T> {
    await this.gate();

    const headers: Record<string, string> = {
      accept: 'application/json',
      'user-agent': this.config.userAgent,
      'accept-language': 'en',
    };
    if (this.config.apiKey) headers.authorization = `Bearer ${this.config.apiKey}`;

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.config.baseUrl}${path}`, {
        headers,
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch {
      throw new GeocodingUnavailableError('The geocoder could not be reached.');
    }

    if (!response.ok) {
      throw new GeocodingUnavailableError(`The geocoder answered ${response.status}.`);
    }

    try {
      return (await response.json()) as T;
    } catch {
      throw new GeocodingUnavailableError(
        'The geocoder returned an unreadable response.',
      );
    }
  }

  /** Spaces upstream calls at least `minIntervalMs` apart, in arrival order. */
  private async gate(): Promise<void> {
    const now = Date.now();
    const slot = Math.max(now, this.nextSlot);
    this.nextSlot = slot + this.minIntervalMs;
    if (slot > now) await new Promise((resolve) => setTimeout(resolve, slot - now));
  }
}

/** Used when geocoding is switched off. Every call is "unavailable". */
export class DisabledGeocodingProvider extends GeocodingProvider {
  readonly name = 'none';

  search(): Promise<GeocodeResult[]> {
    return Promise.reject(
      new GeocodingUnavailableError('Location search is not configured.'),
    );
  }

  reverse(): Promise<GeocodeResult | null> {
    return Promise.reject(
      new GeocodingUnavailableError('Location search is not configured.'),
    );
  }
}

/** Maps a Nominatim place onto the shared shape. Untrusted input, so every field is checked. */
export function toResult(place: NominatimPlace): GeocodeResult | null {
  const latitude = Number(place.lat);
  const longitude = Number(place.lon);
  if (!isCoordinate(latitude, 90) || !isCoordinate(longitude, 180)) return null;

  const address = place.address ?? {};
  const street = [address.house_number, address.road].filter(Boolean).join(' ');
  const locality =
    address.neighbourhood ?? address.suburb ?? address.quarter ?? address.city_district;
  const city =
    address.city ??
    address.town ??
    address.village ??
    address.municipality ??
    address.county;

  const addressLine =
    [street || null, locality ?? null].filter(Boolean).join(', ') || null;

  return {
    label: clip(place.display_name ?? place.name ?? `${latitude}, ${longitude}`, 200),
    latitude,
    longitude,
    address: addressLine ? clip(addressLine, 200) : null,
    city: city ? clip(city, 120) : null,
    state: address.state ? clip(address.state, 120) : null,
    postalCode: address.postcode ? clip(address.postcode, 16) : null,
    country: address.country ? clip(address.country, 120) : null,
    boundingBox: toBoundingBox(place.boundingbox),
  };
}

/** Nominatim orders its box `[south, north, west, east]`; GeoJSON wants `[w, s, e, n]`. */
function toBoundingBox(raw: NominatimPlace['boundingbox']): BoundingBox | null {
  if (!raw || raw.length !== 4) return null;
  const [south, north, west, east] = raw.map(Number) as [number, number, number, number];
  if (![south, north].every((v) => isCoordinate(v, 90))) return null;
  if (![west, east].every((v) => isCoordinate(v, 180))) return null;
  return [west, south, east, north];
}

function isCoordinate(value: number, limit: number): boolean {
  return Number.isFinite(value) && Math.abs(value) <= limit;
}

function clip(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

function isDefined<T>(value: T | null): value is T {
  return value !== null;
}
