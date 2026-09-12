/**
 * Display formatting.
 *
 * All formatters are deterministic given their input and use a fixed locale, so
 * server and client render identical strings and hydration never mismatches.
 */

const LOCALE = 'en-IN';

/** `1234` -> `1,234`. */
export function formatNumber(value: number): string {
  return new Intl.NumberFormat(LOCALE).format(value);
}

/** `1234` -> `1.2k`, for dense cards where the exact figure is not the point. */
export function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat(LOCALE, {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

/** `0.94` -> `94%`. */
export function formatPercent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

/** `1250` -> `1.3 km`; `320` -> `320 m`. */
export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

/** `2026-09-10T…` -> `10 Sep 2026`. */
export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat(LOCALE, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(iso));
}

const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 24 * 60 * 60 * 1000],
  ['month', 30 * 24 * 60 * 60 * 1000],
  ['week', 7 * 24 * 60 * 60 * 1000],
  ['day', 24 * 60 * 60 * 1000],
  ['hour', 60 * 60 * 1000],
  ['minute', 60 * 1000],
];

/**
 * `2026-09-10T…` -> `2 days ago`.
 *
 * Takes an explicit `now` so callers can pass a stable reference — relative
 * time computed independently on server and client would otherwise drift across
 * a second boundary and trip hydration.
 */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const elapsed = new Date(iso).getTime() - now.getTime();
  const formatter = new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto' });

  for (const [unit, milliseconds] of RELATIVE_UNITS) {
    if (Math.abs(elapsed) >= milliseconds) {
      return formatter.format(Math.round(elapsed / milliseconds), unit);
    }
  }

  return 'just now';
}

/** Initials for an avatar fallback: `Priya Sharma` -> `PS`. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}
