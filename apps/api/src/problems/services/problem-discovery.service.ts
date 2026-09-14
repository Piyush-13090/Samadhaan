import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import {
  ACTIVE_PROBLEM_STATUSES,
  DISCOVERY_RANKING,
  type DiscoveryOrigin,
  type ProblemCategory,
  type ProblemFeed,
  type ProblemListItem,
  type ProblemSeverity,
  type ProblemStatus,
  type ProblemUrgency,
} from '@samadhaan/shared';
import { AppException } from '../../common/app.exception.js';
import { PrismaService } from '../../database/prisma.service.js';
import { StorageService } from '../../storage/storage.types.js';
import type { DiscoverProblemsQueryDto } from '../dto/discover-problems.dto.js';

/**
 * Severity as a 0–1 ranking contribution.
 *
 * Hand-chosen and evenly spaced: this is transparent discovery ranking, not a
 * calibrated risk model. The AI priority engine is a later milestone and will
 * replace this with something learned.
 */
const SEVERITY_WEIGHT: Record<ProblemSeverity, number> = {
  LOW: 0.25,
  MEDIUM: 0.5,
  HIGH: 0.75,
  CRITICAL: 1,
};

/** One row as the discovery query returns it. */
interface FeedRow {
  publicId: string;
  title: string;
  category: ProblemCategory;
  subcategory: string | null;
  status: ProblemStatus;
  severity: ProblemSeverity;
  urgency: ProblemUrgency;
  address: string | null;
  city: string | null;
  voteCount: number;
  commentCount: number;
  createdAt: Date;
  reporterId: string;
  thumbnailKey: string | null;
  hasAiAnalysis: boolean;
  distanceMeters: number | null;
  rank: number;
}

/**
 * Finds problems worth showing a citizen.
 *
 * **Everything that can be decided in the database is.** Distance, eligibility,
 * filtering, ranking and the page boundary are all SQL; Node receives at most
 * one page of rows. Fetching problems and measuring distance in JavaScript
 * would work on seed data and fall over on a real city.
 *
 * Ranking is deliberately simple and explainable — see `rankExpression`. The
 * AI priority engine belongs to a later milestone and nothing here pretends to
 * be it.
 */
@Injectable()
export class ProblemDiscoveryService {
  private readonly logger = new Logger(ProblemDiscoveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /**
   * The discovery feed.
   *
   * `viewerId` only ever marks a row as the viewer's own. It never widens what
   * is visible: a discovery feed shows published civic reports and nothing
   * else, to everyone.
   */
  async discover(
    query: DiscoverProblemsQueryDto,
    viewerId: string | null,
  ): Promise<ProblemFeed> {
    const hasCoordinates = query.latitude !== undefined && query.longitude !== undefined;
    const cursor = decodeCursor(query.cursor);

    // The ranking clock, pinned for the whole scroll.
    //
    // Recency decays against a reference time. Letting each page use its own
    // `now()` makes a row's rank drift between requests, which breaks keyset
    // pagination — the boundary row scores fractionally lower on the next
    // request and is returned a second time. Carrying the anchor in the cursor
    // also keeps the feed stable while a citizen reads it, instead of
    // re-ranking under them as they scroll.
    const anchorMs = cursor?.anchorMs ?? Date.now();

    const rows = await this.prisma.$queryRaw<FeedRow[]>(
      this.buildQuery(query, hasCoordinates, cursor, anchorMs),
    );

    // One extra row was requested, purely to learn whether another page exists.
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    const nextCursor =
      rows.length > query.limit && last
        ? encodeCursor(last.rank, last.publicId, anchorMs)
        : null;

    const items = await Promise.all(
      page.map((row) => this.toListItem(row, viewerId)),
    );

    return { items, nextCursor, origin: this.describeOrigin(query, hasCoordinates) };
  }

  /**
   * Builds the feed query.
   *
   * Written as one statement so the planner can use the GiST index on
   * `problems.location` to narrow before anything else runs. `ST_DWithin` is
   * the index-using predicate; `ST_Distance` then measures only what survived.
   */
  private buildQuery(
    query: DiscoverProblemsQueryDto,
    hasCoordinates: boolean,
    cursor: DiscoveryCursor | null,
    anchorMs: number,
  ): Prisma.Sql {
    const origin = hasCoordinates
      ? Prisma.sql`ST_SetSRID(ST_MakePoint(${query.longitude}, ${query.latitude}), 4326)::geography`
      : null;

    const distance = origin
      ? Prisma.sql`ST_Distance(p."location", ${origin})`
      : Prisma.sql`NULL::double precision`;

    const rank = this.rankExpression(query, origin, anchorMs);

    const conditions: Prisma.Sql[] = [
      Prisma.sql`p."deletedAt" IS NULL`,
      // A draft was never published, and a confirmed duplicate should send the
      // reader to the canonical report rather than appearing beside it.
      Prisma.sql`p."status" <> 'DRAFT'`,
      Prisma.sql`p."duplicateOfId" IS NULL`,
    ];

    if (query.status) {
      conditions.push(Prisma.sql`p."status" = ${query.status}::"ProblemStatus"`);
    } else {
      // Default to live work. A feed led by resolved and archived reports
      // answers the wrong question for someone asking what needs attention.
      conditions.push(
        Prisma.sql`p."status" = ANY (${[...ACTIVE_PROBLEM_STATUSES]}::"ProblemStatus"[])`,
      );
    }

    if (query.category) {
      conditions.push(Prisma.sql`p."category" = ${query.category}::"ProblemCategory"`);
    }

    if (origin) {
      conditions.push(Prisma.sql`ST_DWithin(p."location", ${origin}, ${query.radiusMeters})`);
    } else if (query.city) {
      conditions.push(Prisma.sql`p."city" ILIKE ${query.city}`);
    }

    if (cursor) {
      // Keyset pagination on the same expression the rows are ordered by, with
      // `publicId` breaking ties. An OFFSET would skip and repeat rows as new
      // reports arrive mid-scroll, which on a civic feed means losing one.
      conditions.push(
        Prisma.sql`(${rank} < ${cursor.rank}::double precision
          OR (${rank} = ${cursor.rank}::double precision
              AND p."publicId" > ${cursor.publicId}))`,
      );
    }

    return Prisma.sql`
      SELECT
        p."publicId"                                        AS "publicId",
        p."title"                                           AS "title",
        p."category"::text                                  AS "category",
        p."subcategory"                                     AS "subcategory",
        p."status"::text                                    AS "status",
        p."severity"::text                                  AS "severity",
        p."urgency"::text                                   AS "urgency",
        p."address"                                         AS "address",
        p."city"                                            AS "city",
        p."voteCount"                                       AS "voteCount",
        p."commentCount"                                    AS "commentCount",
        p."createdAt"                                       AS "createdAt",
        p."reporterId"                                      AS "reporterId",
        (
          SELECT i."storageKey" FROM problem_images i
          WHERE i."problemId" = p."id" AND i."deletedAt" IS NULL
          ORDER BY i."isPrimary" DESC, i."sortOrder" ASC
          LIMIT 1
        )                                                   AS "thumbnailKey",
        EXISTS (
          SELECT 1 FROM problem_ai_analyses a
          WHERE a."problemId" = p."id"
            AND a."analysisType" = 'INITIAL_ANALYSIS'
            AND a."processingStatus" = 'COMPLETED'
        )                                                   AS "hasAiAnalysis",
        ${distance}                                         AS "distanceMeters",
        ${rank}                                             AS "rank"
      FROM problems p
      WHERE ${Prisma.join(conditions, ' AND ')}
      ORDER BY ${rank} DESC, p."publicId" ASC
      LIMIT ${query.limit + 1}
    `;
  }

  /**
   * The ranking expression.
   *
   * Four signals, weighted, all in 0–1 so the total is comparable across
   * queries:
   *
   *  - **Proximity** — linear decay to zero at the search radius. Absent
   *    without an origin, in which case its weight is simply not applied and
   *    every row scores the same on it.
   *  - **Severity** — the reported band, evenly spaced.
   *  - **Recency** — exponential decay with a 14-day half-life, so a fortnight
   *    old counts half as much as today.
   *  - **Support** — vote count, saturating at 50, so a single very popular
   *    report cannot dominate a whole feed.
   *
   * Kept in SQL rather than sorted in Node because the order decides the page
   * boundary: ranking after pagination would page through one order and
   * display another.
   *
   * `sort` overrides this entirely when the citizen asks for a specific order.
   */
  private rankExpression(
    query: DiscoverProblemsQueryDto,
    origin: Prisma.Sql | null,
    anchorMs: number,
  ): Prisma.Sql {
    // An explicit sort is expressed as a rank so pagination, ordering and the
    // cursor all keep using one expression.
    if (query.sort === 'distance' && origin) {
      return Prisma.sql`(-ST_Distance(p."location", ${origin}))::double precision`;
    }
    if (query.sort === 'recent') {
      return Prisma.sql`EXTRACT(EPOCH FROM p."createdAt")::double precision`;
    }
    if (query.sort === 'severity') {
      return Prisma.sql`(
        CASE p."severity"
          WHEN 'CRITICAL' THEN 4 WHEN 'HIGH' THEN 3
          WHEN 'MEDIUM' THEN 2 ELSE 1
        END * 1e9 + EXTRACT(EPOCH FROM p."createdAt")
      )::double precision`;
    }

    // Every numeric parameter is cast explicitly. A bare `$n` binds as
    // `unknown`, and PostgreSQL will not multiply an unknown by anything —
    // the whole expression fails with "operator does not exist".
    const severity = Prisma.sql`(
      CASE p."severity"
        WHEN 'CRITICAL' THEN ${SEVERITY_WEIGHT.CRITICAL}::double precision
        WHEN 'HIGH'     THEN ${SEVERITY_WEIGHT.HIGH}::double precision
        WHEN 'MEDIUM'   THEN ${SEVERITY_WEIGHT.MEDIUM}::double precision
        ELSE ${SEVERITY_WEIGHT.LOW}::double precision
      END
    )`;

    // Decayed against the pinned anchor rather than `now()`, so one row scores
    // identically on every page of a scroll.
    const anchor = Prisma.sql`to_timestamp(${anchorMs / 1000}::double precision)`;

    const recency = Prisma.sql`POWER(
      0.5::double precision,
      GREATEST(
        0::double precision,
        LEAST(
          EXTRACT(EPOCH FROM (${anchor} - p."createdAt")) / 86400.0
            / ${DISCOVERY_RANKING.recencyHalfLifeDays}::double precision,
          20::double precision
        )
      )
    )`;

    const support = Prisma.sql`LEAST(
      p."voteCount"::double precision
        / ${DISCOVERY_RANKING.supportSaturation}::double precision,
      1::double precision
    )`;

    const weighted: Prisma.Sql[] = [
      Prisma.sql`${DISCOVERY_RANKING.severity}::double precision * ${severity}`,
      Prisma.sql`${DISCOVERY_RANKING.recency}::double precision * ${recency}`,
      Prisma.sql`${DISCOVERY_RANKING.support}::double precision * ${support}`,
    ];

    if (origin) {
      const proximity = Prisma.sql`GREATEST(
        0::double precision,
        1 - (ST_Distance(p."location", ${origin})
             / ${query.radiusMeters}::double precision)
      )`;
      weighted.push(
        Prisma.sql`${DISCOVERY_RANKING.proximity}::double precision * ${proximity}`,
      );
    }

    return Prisma.sql`(${Prisma.join(weighted, ' + ')})`;
  }

  private describeOrigin(
    query: DiscoverProblemsQueryDto,
    hasCoordinates: boolean,
  ): DiscoveryOrigin {
    if (hasCoordinates) {
      return { kind: 'coordinates', label: null, radiusMeters: query.radiusMeters };
    }
    if (query.city) {
      return { kind: 'city', label: query.city, radiusMeters: null };
    }
    return { kind: 'none', label: null, radiusMeters: null };
  }

  /**
   * The citizen's own reports.
   *
   * `userId` is the verified principal, passed by the controller. There is no
   * parameter that can change it.
   */
  async listOwn(
    userId: string,
    query: {
      status?: ProblemStatus;
      category?: ProblemCategory;
      sort: 'recent' | 'oldest' | 'severity' | 'status';
      limit: number;
      cursor?: string;
    },
  ): Promise<{ items: ProblemListItem[]; nextCursor: string | null; totalCount: number }> {
    const where = {
      reporterId: userId,
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.category ? { category: query.category } : {}),
    };

    const [rows, totalCount] = await Promise.all([
      this.prisma.problem.findMany({
        where,
        orderBy: this.ownOrder(query.sort),
        take: query.limit + 1,
        ...(query.cursor
          ? { cursor: { id: decodeIdCursor(query.cursor) }, skip: 1 }
          : {}),
        include: {
          images: {
            where: { deletedAt: null },
            orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
            take: 1,
          },
          aiAnalyses: {
            where: { analysisType: 'INITIAL_ANALYSIS', processingStatus: 'COMPLETED' },
            select: { id: true },
            take: 1,
          },
        },
      }),
      this.prisma.problem.count({ where }),
    ]);

    const page = rows.slice(0, query.limit);
    const nextCursor =
      rows.length > query.limit && page.at(-1) ? encodeIdCursor(page.at(-1)!.id) : null;

    const items = await Promise.all(
      page.map(async (problem) => ({
        publicId: problem.publicId,
        title: problem.title,
        category: problem.category as ProblemCategory,
        subcategory: problem.subcategory,
        status: problem.status as ProblemStatus,
        severity: problem.severity as ProblemSeverity,
        urgency: problem.urgency as ProblemUrgency,
        area: coarseArea(problem.address, problem.city),
        city: problem.city,
        // These are the viewer's own reports; "distance from themselves" is
        // not a question the list is answering.
        distanceMeters: null,
        voteCount: problem.voteCount,
        commentCount: problem.commentCount,
        thumbnailUrl: problem.images[0]
          ? await this.storage.getUrl(problem.images[0].storageKey)
          : null,
        createdAt: problem.createdAt.toISOString(),
        hasAiAnalysis: problem.aiAnalyses.length > 0,
        isOwnReport: true,
      })),
    );

    return { items, nextCursor, totalCount };
  }

  private ownOrder(sort: 'recent' | 'oldest' | 'severity' | 'status') {
    switch (sort) {
      case 'oldest':
        return [{ createdAt: 'asc' as const }, { id: 'asc' as const }];
      case 'severity':
        return [
          { severity: 'desc' as const },
          { createdAt: 'desc' as const },
          { id: 'asc' as const },
        ];
      case 'status':
        return [
          { status: 'asc' as const },
          { createdAt: 'desc' as const },
          { id: 'asc' as const },
        ];
      default:
        return [{ createdAt: 'desc' as const }, { id: 'asc' as const }];
    }
  }

  /** Maps a feed row onto the response shape. An allow-list, as everywhere. */
  private async toListItem(
    row: FeedRow,
    viewerId: string | null,
  ): Promise<ProblemListItem> {
    return {
      publicId: row.publicId,
      title: row.title,
      category: row.category,
      subcategory: row.subcategory,
      status: row.status,
      severity: row.severity,
      urgency: row.urgency,
      area: coarseArea(row.address, row.city),
      city: row.city,
      distanceMeters:
        row.distanceMeters === null ? null : Math.round(Number(row.distanceMeters)),
      voteCount: row.voteCount,
      commentCount: row.commentCount,
      thumbnailUrl: row.thumbnailKey
        ? await this.storage.getUrl(row.thumbnailKey)
        : null,
      createdAt: row.createdAt.toISOString(),
      hasAiAnalysis: row.hasAiAnalysis,
      // `reporterId` is selected to answer this and is never published itself.
      ...(viewerId ? { isOwnReport: row.reporterId === viewerId } : {}),
    };
  }
}

/**
 * A short locality label for a feed card.
 *
 * The full street address is on the problem's own page, where it belongs. In a
 * list of other people's reports the first address segment plus the city is
 * enough to place it, and stops the feed reading as a directory of addresses.
 */
export function coarseArea(address: string | null, city: string | null): string | null {
  const segment = address?.split(',')[0]?.trim();
  if (segment) return segment;
  return city;
}

/**
 * Keyset cursor for the ranked feed.
 *
 * Carries the ranking anchor alongside the position, so every page of one
 * scroll is ranked against the same instant.
 */
interface DiscoveryCursor {
  rank: number;
  publicId: string;
  anchorMs: number;
}

function encodeCursor(rank: number, publicId: string, anchorMs: number): string {
  return Buffer.from(`${rank}|${publicId}|${anchorMs}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor?: string): DiscoveryCursor | null {
  if (!cursor) return null;

  const [rank, publicId, anchor] = Buffer.from(cursor, 'base64url')
    .toString('utf8')
    .split('|');

  const parsedRank = Number(rank);
  const parsedAnchor = Number(anchor);

  // A malformed cursor is a client error, not a reason to silently serve page
  // one — which would loop forever as the client kept "advancing".
  if (!publicId || !Number.isFinite(parsedRank) || !Number.isFinite(parsedAnchor)) {
    throw AppException.badRequest('That page cursor is not valid.');
  }

  return { rank: parsedRank, publicId, anchorMs: parsedAnchor };
}

function encodeIdCursor(id: string): string {
  return Buffer.from(id, 'utf8').toString('base64url');
}

function decodeIdCursor(cursor: string): string {
  const id = Buffer.from(cursor, 'base64url').toString('utf8');

  // Prisma's `cursor` needs a real row id; anything else throws deep in the
  // client with a message about a where clause.
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    throw AppException.badRequest('That page cursor is not valid.');
  }

  return id;
}
