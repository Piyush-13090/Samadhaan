import {
  ANALYTICS_MIN_GROUP_SIZE,
  type AreaRow,
  type CategoryRow,
  type FunnelStage,
  type HotspotCell,
  type ProblemCategory,
  type ProblemSeverity,
  type StageDuration,
} from '@samadhaan/shared';

/**
 * Pure metric rules (Prompt 24). Everything that turns counts into rates,
 * changes, funnels and hotspots lives here, so each rule is unit-tested and
 * documented in docs/ANALYTICS_METRICS.md.
 *
 * The rule everywhere: when the data cannot support a number, the number is
 * `null` — the UI then says "Not enough data yet". Nothing is padded.
 */

/** A comparison needs at least this many in the previous period. */
export const MIN_COMPARISON_BASE = 5;
/** A duration or rate needs at least this many observations. */
export const MIN_OBSERVATIONS = 3;
/** Change within ±10 % is "stable". */
export const STABLE_BAND_PCT = 10;

export const round = (value: number, places = 1): number => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

/** numerator ÷ denominator as a percentage, or null when there is no base. */
export function ratePct(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(denominator) || denominator <= 0) return null;
  return round((numerator / denominator) * 100);
}

/** Relative change in %, or null ("Comparison unavailable") on a thin base. */
export function changePct(current: number, previous: number): number | null {
  if (!Number.isFinite(previous) || previous < MIN_COMPARISON_BASE) return null;
  return round(((current - previous) / previous) * 100);
}

export function direction(change: number | null): CategoryRow['direction'] {
  if (change === null) return 'unknown';
  if (change > STABLE_BAND_PCT) return 'increasing';
  if (change < -STABLE_BAND_PCT) return 'decreasing';
  return 'stable';
}

/** A mean or median in days, kept only with enough observations. */
export function enoughDays(
  value: number | null | undefined,
  observations: number,
): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  if (observations < MIN_OBSERVATIONS) return null;
  return round(Math.max(0, value));
}

/** Time-to-resolution buckets, in days. Upper bounds are exclusive. */
export const DURATION_BUCKETS: ReadonlyArray<{
  label: string;
  min: number;
  max: number;
}> = [
  { label: '< 1 day', min: 0, max: 1 },
  { label: '1–3 days', min: 1, max: 3 },
  { label: '3–7 days', min: 3, max: 7 },
  { label: '7–14 days', min: 7, max: 14 },
  { label: '14–30 days', min: 14, max: 30 },
  { label: '30+ days', min: 30, max: Number.POSITIVE_INFINITY },
];

export function distribution(
  durationsDays: number[],
): Array<{ bucket: string; count: number }> {
  return DURATION_BUCKETS.map(({ label, min, max }) => ({
    bucket: label,
    count: durationsDays.filter((d) => d >= min && d < max).length,
  }));
}

export const FUNNEL_LABELS: Record<FunnelStage['key'], string> = {
  submitted: 'Submitted',
  review: 'Under review',
  verified: 'Verified',
  allocated: 'Allocated',
  inProgress: 'In progress',
  resolved: 'Resolved',
};

/** Conversion of each stage from the one before it. Counts are cumulative. */
export function funnel(counts: Record<FunnelStage['key'], number>): FunnelStage[] {
  const keys = Object.keys(FUNNEL_LABELS) as Array<FunnelStage['key']>;
  return keys.map((key, index) => ({
    key,
    label: FUNNEL_LABELS[key],
    count: counts[key],
    conversionPct: index === 0 ? null : ratePct(counts[key], counts[keys[index - 1]]),
  }));
}

export const STAGE_LABELS: Record<StageDuration['key'], string> = {
  review: 'Report → review started',
  verification: 'Review → verified',
  allocation: 'Verified → allocated',
  acceptance: 'Allocated → accepted',
  execution: 'Accepted → resolved',
};

/**
 * The stage with the longest observed average. Descriptive only — it says
 * where time is spent, not why. Needs averages on at least two stages.
 */
export function bottleneck(stages: StageDuration[]): {
  key: StageDuration['key'];
  label: string;
  avgDays: number;
} | null {
  const measured = stages.filter(
    (s): s is StageDuration & { avgDays: number } => s.avgDays !== null,
  );
  if (measured.length < 2) return null;
  const top = measured.reduce((a, b) => (b.avgDays > a.avgDays ? b : a));
  return top.avgDays > 0
    ? { key: top.key, label: top.label, avgDays: top.avgDays }
    : null;
}

/** Areas below the minimum group size keep their name but not their counts. */
export function suppress(
  rows: Array<{ name: string; count: number; open: number; resolved: number }>,
  minimum = ANALYTICS_MIN_GROUP_SIZE,
): AreaRow[] {
  return rows.map((row) =>
    row.count < minimum
      ? { name: row.name, count: null, open: null, resolved: null, suppressed: true }
      : { ...row, suppressed: false },
  );
}

// ------------------------------------------------------------------ hotspots

export const HOTSPOT_ALGORITHM = 'grid-zscore-v1';
/** Grid cell edge, in degrees of latitude and longitude (~0.55 km). */
export const HOTSPOT_CELL_DEGREES = 0.005;
/** Recency half-life: a report this old weighs half as much. */
export const HOTSPOT_HALF_LIFE_DAYS = 30;
/** A hotspot is at least this many standard deviations above the mean. */
export const HOTSPOT_MIN_Z = 2;
/** …with at least this many problems… */
export const HOTSPOT_MIN_COUNT = 3;
/** …among at least this many occupied cells (a z-score needs a population). */
export const HOTSPOT_MIN_CELLS = 5;

export const SEVERITY_WEIGHT: Record<ProblemSeverity, number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

export interface CellAggregate {
  cellX: number;
  cellY: number;
  latitude: number;
  longitude: number;
  label: string | null;
  count: number;
  open: number;
  /** Σ severity weight × recency weight, computed in SQL. */
  weighted: number;
  topCategory: ProblemCategory | null;
}

export function cellAreaKm2(latitude: number, degrees = HOTSPOT_CELL_DEGREES): number {
  const kmPerDegree = 111.32;
  return (
    degrees * kmPerDegree * (degrees * kmPerDegree * Math.cos((latitude * Math.PI) / 180))
  );
}

/**
 * Deterministic hotspot scoring: weighted density per km², then a z-score
 * against the other occupied cells. Confidence grows with the number of
 * reports (1 − e^(−n/5)). The same input always gives the same output.
 */
export function scoreHotspots(cells: CellAggregate[]): {
  scored: HotspotCell[];
  enoughCells: boolean;
} {
  const densities = cells.map((c) => c.weighted / cellAreaKm2(c.latitude));
  const n = densities.length;
  const mean = n ? densities.reduce((a, b) => a + b, 0) / n : 0;
  const sd = n ? Math.sqrt(densities.reduce((a, b) => a + (b - mean) ** 2, 0) / n) : 0;
  const enoughCells = n >= HOTSPOT_MIN_CELLS;

  const scored = cells.map((cell, i) => {
    const z = sd > 0 ? (densities[i] - mean) / sd : 0;
    return {
      id: `${HOTSPOT_CELL_DEGREES}:${cell.cellX}:${cell.cellY}`,
      latitude: cell.latitude,
      longitude: cell.longitude,
      label: cell.label,
      problemCount: cell.count,
      openCount: cell.open,
      severityScore: round(cell.weighted, 2),
      density: round(densities[i], 2),
      zScore: round(z, 2),
      isHotspot: enoughCells && z >= HOTSPOT_MIN_Z && cell.count >= HOTSPOT_MIN_COUNT,
      confidence: round(1 - Math.exp(-cell.count / 5), 2),
      topCategory: cell.topCategory,
    };
  });
  scored.sort((a, b) => b.zScore - a.zScore || b.problemCount - a.problemCount);
  return { scored, enoughCells };
}

// ----------------------------------------------------------------------- csv

/**
 * One CSV cell. Quoted always; a leading =, +, -, @, tab or carriage return
 * is prefixed with an apostrophe so a spreadsheet never evaluates it.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '""';
  let text = value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function toCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  return [
    headers.map(csvCell).join(','),
    ...rows.map((row) => headers.map((h) => csvCell(row[h])).join(',')),
  ].join('\r\n');
}
