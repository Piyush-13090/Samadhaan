import { Injectable } from '@nestjs/common';
import {
  ACTIVE_PROBLEM_STATUSES,
  MAP_AGGREGATE_MAX_SPAN_DEGREES,
  MAP_DETAIL_MAX_SPAN_DEGREES,
  type BoundingBox,
  type MapAggregateCollection,
  type MapProblemCollection,
  type MapProblemFeature,
  type ProblemCategory,
  type ProblemSeverity,
  type ProblemStatus,
} from '@samadhaan/shared';
import { AppException } from '../../common/app.exception.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { coarseArea } from './problem-discovery.service.js';

interface MapRow {
  publicId: string;
  title: string;
  category: ProblemCategory;
  subcategory: string | null;
  severity: ProblemSeverity;
  status: ProblemStatus;
  address: string | null;
  city: string | null;
  voteCount: number;
  createdAt: Date;
  latitude: number;
  longitude: number;
  distanceMeters: number | null;
}

interface CellRow {
  latitude: number;
  longitude: number;
  count: number;
  low: number;
  medium: number;
  high: number;
  critical: number;
  topCategories: Array<{ category: ProblemCategory; count: number }> | null;
}

/** Grid sizes the aggregation snaps to, in degrees. */
const CELL_STEPS = [0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2] as const;

/** Roughly how many cells across the longer side of the viewport. */
const CELLS_ACROSS = 16;

/**
 * Problems on a map, and the geographic aggregation beneath it.
 *
 * **The database does the geography.** Every query is bounded by the viewport,
 * and the viewport is bounded by this service, so the worst case is a known
 * rectangle — never "all problems". The bounding-box test is
 * `location && ST_MakeEnvelope(…)::geography`, which the GiST index on
 * `problems.location` answers; an exact range check on the decimal columns
 * then trims the box's edges. Distances are `ST_Distance` on geography — real
 * metres on the spheroid, never Pythagoras in JavaScript.
 *
 * The visibility rule is the discovery feed's: no drafts, no confirmed
 * duplicates, no deleted rows, and live work unless a status is asked for.
 *
 * Antimeridian-crossing viewports (`west > east`) are refused rather than
 * split. Samadhaan maps India; when that changes, the box becomes two.
 */
/** A viewport and the public filters. The DTOs satisfy it; so does a scoped caller. */
export interface MapViewportInput {
  west: number;
  south: number;
  east: number;
  north: number;
  category?: ProblemCategory;
  severity?: ProblemSeverity;
  /** Any status; the public DTO restricts it to the citizen-facing five. */
  status?: ProblemStatus;
}

export interface MapProblemsInput extends MapViewportInput {
  limit: number;
  originLatitude?: number;
  originLongitude?: number;
}

/**
 * Extra conditions from a caller with its own authority — the government
 * map's jurisdiction and review filters. Appended to, never replacing, the
 * visibility rules above.
 */
export interface MapScope {
  conditions: Prisma.Sql[];
  /** The caller validated `status` against a wider set (e.g. DUPLICATE). */
  anyStatus?: boolean;
}

@Injectable()
export class ProblemMapService {
  constructor(private readonly prisma: PrismaService) {}

  // ============================================================= problems

  async problems(
    query: MapProblemsInput,
    scope?: MapScope,
  ): Promise<MapProblemCollection> {
    const bbox = assertViewport(query, MAP_DETAIL_MAX_SPAN_DEGREES);
    const origin =
      query.originLatitude !== undefined && query.originLongitude !== undefined
        ? Prisma.sql`ST_SetSRID(ST_MakePoint(${query.originLongitude}, ${query.originLatitude}), 4326)::geography`
        : null;

    const rows = await this.prisma.$queryRaw<MapRow[]>`
      SELECT
        p."publicId"                AS "publicId",
        p."title"                   AS "title",
        p."category"::text          AS "category",
        p."subcategory"             AS "subcategory",
        p."severity"::text          AS "severity",
        p."status"::text            AS "status",
        p."address"                 AS "address",
        p."city"                    AS "city",
        p."voteCount"               AS "voteCount",
        p."createdAt"               AS "createdAt",
        p."latitude"::double precision  AS "latitude",
        p."longitude"::double precision AS "longitude",
        ${origin ? Prisma.sql`ST_Distance(p."location", ${origin})` : Prisma.sql`NULL::double precision`}
                                    AS "distanceMeters"
      FROM problems p
      WHERE ${this.conditions(query, bbox, scope)}
      ORDER BY
        CASE p."severity"
          WHEN 'CRITICAL' THEN 4 WHEN 'HIGH' THEN 3 WHEN 'MEDIUM' THEN 2 ELSE 1
        END DESC,
        p."createdAt" DESC,
        p."publicId" ASC
      LIMIT ${query.limit + 1}
    `;

    const page = rows.slice(0, query.limit);

    return {
      type: 'FeatureCollection',
      features: page.map(toFeature),
      bbox,
      // When a viewport holds more than the limit, the most severe are kept —
      // the ones a citizen most needs to see — and the client is told to
      // zoom in for the rest.
      truncated: rows.length > query.limit,
    };
  }

  // ========================================================== aggregation

  /**
   * Problems grouped into a grid over the viewport — the hotspot foundation.
   *
   * Each cell reports how many problems it holds, how they split by severity,
   * and its leading categories, positioned at the centroid of its problems
   * (not the cell corner, so a cluster of three sits where they are). The grid
   * size is chosen from the viewport so a city and a country both come back as
   * a few dozen cells.
   *
   * Reusable by design: the government command center and city analytics will
   * call this with their own viewports and filters. It is deliberately simple —
   * counts on a grid, not a statistical hotspot model.
   */
  async aggregate(
    query: MapViewportInput,
    cellSizeDegrees?: number,
    scope?: MapScope,
  ): Promise<MapAggregateCollection> {
    const bbox = assertViewport(query, MAP_AGGREGATE_MAX_SPAN_DEGREES);
    const cell = cellSizeDegrees ?? chooseCellSize(bbox);

    const rows = await this.prisma.$queryRaw<CellRow[]>`
      WITH base AS (
        SELECT
          floor(p."longitude"::double precision / ${cell}::double precision)::int AS cx,
          floor(p."latitude"::double precision / ${cell}::double precision)::int  AS cy,
          p."latitude"::double precision  AS latitude,
          p."longitude"::double precision AS longitude,
          p."severity",
          p."category"
        FROM problems p
        WHERE ${this.conditions(query, bbox, scope)}
      ),
      categories AS (
        SELECT cx, cy, category, count(*)::int AS n,
               row_number() OVER (PARTITION BY cx, cy ORDER BY count(*) DESC, category) AS rank
        FROM base
        GROUP BY cx, cy, category
      ),
      top AS (
        SELECT cx, cy,
               jsonb_agg(jsonb_build_object('category', category::text, 'count', n)
                         ORDER BY n DESC, category) AS "topCategories"
        FROM categories
        WHERE rank <= 3
        GROUP BY cx, cy
      )
      SELECT
        avg(b.latitude)  AS "latitude",
        avg(b.longitude) AS "longitude",
        count(*)::int                                          AS "count",
        count(*) FILTER (WHERE b."severity" = 'LOW')::int      AS "low",
        count(*) FILTER (WHERE b."severity" = 'MEDIUM')::int   AS "medium",
        count(*) FILTER (WHERE b."severity" = 'HIGH')::int     AS "high",
        count(*) FILTER (WHERE b."severity" = 'CRITICAL')::int AS "critical",
        t."topCategories"                                      AS "topCategories"
      FROM base b
      JOIN top t ON t.cx = b.cx AND t.cy = b.cy
      GROUP BY b.cx, b.cy, t."topCategories"
      ORDER BY count(*) DESC
    `;

    return {
      type: 'FeatureCollection',
      features: rows.map((row) => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [round(Number(row.longitude)), round(Number(row.latitude))],
        },
        properties: {
          count: row.count,
          severity: {
            LOW: row.low,
            MEDIUM: row.medium,
            HIGH: row.high,
            CRITICAL: row.critical,
          },
          topCategories: row.topCategories ?? [],
        },
      })),
      bbox,
      cellSizeDegrees: cell,
      totalCount: rows.reduce((sum, row) => sum + row.count, 0),
    };
  }

  // ================================================================ shared

  /**
   * The WHERE clause both queries share. Every value is a bound parameter; the
   * enum casts are on parameters the DTO has already constrained to known
   * values.
   */
  private conditions(
    query: MapViewportInput,
    bbox: BoundingBox,
    scope?: MapScope,
  ): Prisma.Sql {
    const [west, south, east, north] = bbox;

    const conditions: Prisma.Sql[] = [
      Prisma.sql`p."deletedAt" IS NULL`,
      Prisma.sql`p."status" <> 'DRAFT'`,
      // Confirmed duplicates are hidden — unless a scoped caller asked for
      // exactly them.
      ...(scope?.anyStatus && query.status === 'DUPLICATE'
        ? []
        : [Prisma.sql`p."duplicateOfId" IS NULL`]),
      // Index-assisted: the GiST index on `location` answers `&&`.
      Prisma.sql`p."location" && ST_MakeEnvelope(
        ${west}::double precision, ${south}::double precision,
        ${east}::double precision, ${north}::double precision, 4326
      )::geography`,
      // Exact edges. A geography envelope's sides are geodesics, which bow
      // slightly from the straight lines a map draws; this keeps the result to
      // exactly the rectangle on screen.
      Prisma.sql`p."longitude" BETWEEN ${west}::numeric AND ${east}::numeric`,
      Prisma.sql`p."latitude" BETWEEN ${south}::numeric AND ${north}::numeric`,
    ];

    conditions.push(
      query.status
        ? Prisma.sql`p."status" = ${query.status}::"ProblemStatus"`
        : Prisma.sql`p."status" = ANY (${[...ACTIVE_PROBLEM_STATUSES]}::"ProblemStatus"[])`,
    );

    if (query.category) {
      conditions.push(Prisma.sql`p."category" = ${query.category}::"ProblemCategory"`);
    }
    if (query.severity) {
      conditions.push(Prisma.sql`p."severity" = ${query.severity}::"ProblemSeverity"`);
    }

    conditions.push(...(scope?.conditions ?? []));

    return Prisma.join(conditions, ' AND ');
  }
}

/**
 * Validates a viewport and returns it as a bounding box.
 *
 * The DTO checks each edge is a real coordinate; this checks they form a box
 * the endpoint is willing to search. An oversized box is the expensive request
 * this whole design exists to refuse, so it is a 400, not a silent clamp the
 * client would mistake for a complete answer.
 */
export function assertViewport(
  query: Pick<MapViewportInput, 'west' | 'south' | 'east' | 'north'>,
  maxSpan: number,
): BoundingBox {
  const { west, south, east, north } = query;

  if (south >= north) {
    throw AppException.badRequest('south must be less than north.');
  }
  if (west >= east) {
    throw AppException.badRequest(
      'west must be less than east. Viewports crossing the antimeridian are not supported.',
    );
  }
  if (north - south > maxSpan || east - west > maxSpan) {
    throw AppException.badRequest(
      `That area is too large. Zoom in to an area at most ${maxSpan}° across.`,
    );
  }

  return [west, south, east, north];
}

/** The smallest grid step giving at most ~16 cells across the viewport. */
export function chooseCellSize(bbox: BoundingBox): number {
  const span = Math.max(bbox[2] - bbox[0], bbox[3] - bbox[1]);
  const target = span / CELLS_ACROSS;
  return CELL_STEPS.find((step) => step >= target) ?? CELL_STEPS.at(-1)!;
}

/** Five decimals is about a metre — more precision than a civic location needs. */
function round(value: number): number {
  return Math.round(value * 1e5) / 1e5;
}

function toFeature(row: MapRow): MapProblemFeature {
  return {
    type: 'Feature',
    id: row.publicId,
    geometry: {
      type: 'Point',
      coordinates: [round(Number(row.longitude)), round(Number(row.latitude))],
    },
    // An allow-list, as everywhere. `reporterId` is not even selected.
    properties: {
      publicId: row.publicId,
      title: row.title,
      category: row.category,
      subcategory: row.subcategory,
      severity: row.severity,
      status: row.status,
      area: coarseArea(row.address, row.city),
      city: row.city,
      voteCount: row.voteCount,
      createdAt: row.createdAt.toISOString(),
      distanceMeters:
        row.distanceMeters === null ? null : Math.round(Number(row.distanceMeters)),
    },
  };
}
