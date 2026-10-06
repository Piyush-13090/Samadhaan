/**
 * Map configuration, from public environment variables.
 *
 * Only *public* values live here. The style URL is fetched by the browser by
 * definition, so anything in it — including a provider's browser key — is
 * public; that is the one case where a key may appear. Geocoding keys never do:
 * geocoding runs on the API.
 *
 * Next inlines `NEXT_PUBLIC_*` at build time, so each is read as a full literal
 * property access.
 */

export type MapProviderId = 'maplibre' | 'none';

/** OpenFreeMap's OSM-based vector style: free, keyless, attribution included. */
const DEFAULT_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

/** India, whole. Before anyone chooses a place, the map shows the country. */
const DEFAULT_VIEW = { latitude: 22.5, longitude: 79, zoom: 4 };

export interface MapView {
  latitude: number;
  longitude: number;
  zoom: number;
}

export const mapConfig = {
  provider: parseProvider(process.env.NEXT_PUBLIC_MAP_PROVIDER),
  styleUrl: process.env.NEXT_PUBLIC_MAP_STYLE_URL || DEFAULT_STYLE_URL,
  defaultView: parseView(process.env.NEXT_PUBLIC_MAP_DEFAULT_VIEW),
  /** Zoom used when focusing on a single place — a street, roughly. */
  placeZoom: 15,
} as const;

function parseProvider(raw: string | undefined): MapProviderId {
  return raw === 'none' ? 'none' : 'maplibre';
}

/** `"lat,lng,zoom"`, validated; anything malformed falls back to the default. */
export function parseView(raw: string | undefined): MapView {
  if (!raw) return DEFAULT_VIEW;
  const [latitude, longitude, zoom] = raw.split(',').map((part) => Number(part.trim()));

  if (
    latitude === undefined ||
    longitude === undefined ||
    zoom === undefined ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    !Number.isFinite(zoom) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180 ||
    zoom < 0 ||
    zoom > 22
  ) {
    return DEFAULT_VIEW;
  }

  return { latitude, longitude, zoom };
}
