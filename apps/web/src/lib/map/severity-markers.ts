import type { ProblemSeverity } from '@samadhaan/shared';

/**
 * How severity looks on the map — shape first, colour second.
 *
 * Each band has its own silhouette, so severity survives colour blindness,
 * greyscale printing and a bright screen outdoors: low is a circle, medium a
 * square, high a triangle, critical a diamond with a ring. Colour reinforces
 * the shape; it never carries the meaning alone.
 *
 * Defined once as SVG paths in a 24×24 box and drawn twice — as `<path>` in the
 * legend, and through `Path2D` onto the canvas images the map renders — so the
 * legend cannot drift from what the map shows.
 */
export interface SeverityMarker {
  /** SVG path data, 24×24 viewBox. */
  path: string;
  fill: string;
  /** Map image id. */
  icon: string;
}

export const SEVERITY_MARKERS: Record<ProblemSeverity, SeverityMarker> = {
  LOW: {
    path: 'M12 5a7 7 0 1 1 0 14a7 7 0 1 1 0-14Z',
    fill: '#626872',
    icon: 'severity-low',
  },
  MEDIUM: {
    path: 'M5.5 5.5h13v13h-13Z',
    fill: '#b45309',
    icon: 'severity-medium',
  },
  HIGH: {
    path: 'M12 3.5l9 16h-18Z',
    fill: '#dc2626',
    icon: 'severity-high',
  },
  CRITICAL: {
    path: 'M12 1.5l10.5 10.5l-10.5 10.5l-10.5-10.5Z',
    fill: '#991b1b',
    icon: 'severity-critical',
  },
};

/** Severity bands from least to most severe, for legends and filters. */
export const SEVERITY_ORDER: ProblemSeverity[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

/** Map colours that are not severity: clusters, selection, the user. */
export const MAP_COLORS = {
  cluster: '#2563eb',
  clusterText: '#ffffff',
  selection: '#2563eb',
  user: '#2563eb',
  outline: '#ffffff',
} as const;
