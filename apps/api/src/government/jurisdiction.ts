import type { BoundingBox, Jurisdiction, JurisdictionType } from '@samadhaan/shared';
import type { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';

/** A government office's area, resolved once per request. */
export interface ResolvedJurisdiction {
  view: Jurisdiction;
  /**
   * The SQL predicate, over a problem aliased `p`, that decides whether a
   * problem is inside the jurisdiction. Every government query includes it —
   * it is the authorisation, not a filter.
   */
  condition: Prisma.Sql;
}

/**
 * Resolves a government organisation's jurisdiction into a predicate.
 *
 * In order of precedence:
 *
 *  1. **Boundary** — `ST_Covers(boundary, p.location)`. The boundary is read
 *     once (an InitPlan), and the GiST index on `problems.location` narrows
 *     the candidates.
 *  2. **Cities** — the problem's city, case-insensitively, is one of them.
 *  3. **Postal codes** — the problem's postal code is one of them.
 *  4. **Nothing defined → `false`.** An office whose area was never set up
 *     sees no problems at all, rather than every problem in the country.
 *
 * Nothing the client sends — a city in the query string, a bounding box —
 * takes part. Filters narrow *within* this; they never widen it.
 */
export async function resolveJurisdiction(
  prisma: PrismaService,
  organizationId: string,
): Promise<ResolvedJurisdiction> {
  const [row] = await prisma.$queryRaw<
    Array<{
      type: JurisdictionType | null;
      name: string | null;
      cities: string[];
      postalCodes: string[];
      hasBoundary: boolean;
      west: number | null;
      south: number | null;
      east: number | null;
      north: number | null;
    }>
  >`
    SELECT
      o."jurisdictionType"::text            AS "type",
      o."jurisdictionName"                  AS "name",
      o."jurisdictionCities"                AS "cities",
      o."jurisdictionPostalCodes"           AS "postalCodes",
      o."jurisdictionBoundary" IS NOT NULL  AS "hasBoundary",
      ST_XMin(o."jurisdictionBoundary"::geometry) AS "west",
      ST_YMin(o."jurisdictionBoundary"::geometry) AS "south",
      ST_XMax(o."jurisdictionBoundary"::geometry) AS "east",
      ST_YMax(o."jurisdictionBoundary"::geometry) AS "north"
    FROM organizations o
    WHERE o.id = ${organizationId}::uuid
  `;

  const cities = (row?.cities ?? []).map((city) => city.trim()).filter(Boolean);
  const postalCodes = (row?.postalCodes ?? []).map((code) => code.trim()).filter(Boolean);

  let basis: Jurisdiction['basis'] = 'none';
  let condition = Prisma.sql`false`;

  if (row?.hasBoundary) {
    basis = 'boundary';
    condition = Prisma.sql`ST_Covers(
      (SELECT g."jurisdictionBoundary" FROM organizations g WHERE g.id = ${organizationId}::uuid),
      p."location"
    )`;
  } else if (cities.length > 0) {
    basis = 'cities';
    condition = Prisma.sql`lower(p."city") = ANY (${cities.map((city) => city.toLowerCase())}::text[])`;
  } else if (postalCodes.length > 0) {
    basis = 'postal-codes';
    condition = Prisma.sql`upper(p."postalCode") = ANY (${postalCodes.map((code) => code.toUpperCase())}::text[])`;
  }

  const bbox: BoundingBox | null =
    row?.hasBoundary &&
    row.west !== null &&
    row.south !== null &&
    row.east !== null &&
    row.north !== null
      ? [Number(row.west), Number(row.south), Number(row.east), Number(row.north)]
      : null;

  return {
    view: {
      type: row?.type ?? null,
      name: row?.name ?? null,
      basis,
      cities,
      postalCodes,
      bbox,
    },
    condition,
  };
}
