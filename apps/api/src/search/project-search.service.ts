import { Injectable } from '@nestjs/common';
import type {
  ProjectSearchResult,
  SearchPage,
  SearchUnderstanding,
} from '@samadhaan/shared';
import type { RequestUser } from '../auth/auth.types.js';
import { AppException } from '../common/app.exception.js';
import { AppConfig } from '../config/app.config.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { SearchAuthorizationService } from './search-authorization.service.js';
import { SearchCacheService, type CachedList } from './search-cache.service.js';
import { decodeSearchCursor, encodeSearchCursor } from './search-cursor.js';
import { highlightFields, searchTerms } from './search-highlight.js';
import { PROBLEM_TSV, PROJECT_TSV, anyTerms } from './search-sql.js';
import type { ProjectSearchDto } from './search.dto.js';

interface ProjectRow {
  id: string;
  roomId: string;
  name: string;
  description: string | null;
  status: string;
  problemPublicId: string;
  problemTitle: string;
  organizationName: string;
  governmentName: string;
  rank: number;
}

/**
 * Project search (Prompt 25): only projects the caller participates in — as
 * a member of the assigned organisation, or as an official of the office
 * within its jurisdiction. Citizens have no project access, so their result
 * is empty. Names, descriptions and the problem are searched; room messages
 * never are.
 */
@Injectable()
export class ProjectSearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly access: SearchAuthorizationService,
    private readonly cache: SearchCacheService,
  ) {}

  async search(
    dto: ProjectSearchDto,
    user: RequestUser,
    preread?: { understanding: SearchUnderstanding; text: string } | null,
  ): Promise<SearchPage<ProjectSearchResult>> {
    const text = preread ? (dto.q ?? preread.text) : (dto.q ?? '');
    const understanding = preread?.understanding ?? null;
    const predicate = await this.access.projectPredicate(user);
    // Private to the user: the key embeds them, so lists are never shared.
    const key = this.cache.key([
      'projects',
      `user:${user.id}`,
      SearchAuthorizationService.fingerprint(predicate),
      text.toLowerCase(),
      dto.status ?? null,
    ]);
    const cursor = decodeSearchCursor(dto.cursor);
    if (cursor && (cursor.kind !== 'list' || cursor.key !== key)) {
      throw AppException.badRequest('That page cursor does not belong to this search.');
    }

    let list = await this.cache.get(key);
    let rows: ProjectRow[] | null = null;
    if (!list) {
      rows = await this.query(predicate, text, dto.status, null);
      list = {
        entries: rows.map((r) => ({
          id: r.id,
          score: r.rank,
          explanation: text ? ['Matches your words'] : [],
        })),
        match: rows.length ? 'exact' : 'none',
        signals: text ? ['keyword'] : ['filters'],
      } satisfies CachedList;
      await this.cache.set(key, list);
    }
    const offset = cursor?.kind === 'list' ? cursor.offset : 0;
    const slice = list.entries.slice(offset, offset + dto.limit);
    const page = await this.query(
      predicate,
      '',
      dto.status,
      slice.map((e) => e.id),
    );
    const byId = new Map(page.map((r) => [r.id, r]));
    const terms = searchTerms(text);
    const next = offset + dto.limit;
    return {
      items: slice
        .map((e) => byId.get(e.id))
        .filter((r): r is ProjectRow => r !== undefined)
        .map((r) => ({
          type: 'PROJECT' as const,
          id: r.id,
          title: r.name,
          subtitle: `${r.problemPublicId} · ${r.organizationName}`,
          href: `/resolution/${r.roomId}/project`,
          score: list!.entries.find((e) => e.id === r.id)?.score ?? 0,
          highlights: highlightFields(
            [
              { field: 'title', text: r.name },
              { field: 'description', text: r.description, excerpt: true },
              { field: 'problem', text: r.problemTitle },
            ],
            terms,
          ),
          explanation: text ? ['Matches your words'] : [],
          metadata: {
            status: r.status,
            problemPublicId: r.problemPublicId,
            problemTitle: r.problemTitle,
            organizationName: r.organizationName,
            governmentName: r.governmentName,
          },
        })),
      nextCursor:
        next < list.entries.length
          ? encodeSearchCursor({ kind: 'list', key, offset: next })
          : null,
      total: list.entries.length,
      match: list.match,
      understanding,
      signals: list.signals,
    };
  }

  private query(
    predicate: Prisma.Sql,
    text: string,
    status: string | undefined,
    ids: string[] | null,
  ): Promise<ProjectRow[]> {
    const hasText = text.trim().length >= 2;
    const conditions = [predicate];
    if (status)
      conditions.push(Prisma.sql`r."status" = ${status}::"ResolutionProjectStatus"`);
    if (ids) conditions.push(Prisma.sql`r.id = ANY(${ids}::uuid[])`);
    if (hasText) {
      conditions.push(
        Prisma.sql`(${PROJECT_TSV} @@ ${anyTerms(text)} OR ${PROBLEM_TSV} @@ ${anyTerms(text)})`,
      );
    }
    const rank = hasText
      ? Prisma.sql`(ts_rank_cd(${PROJECT_TSV}, ${anyTerms(text)}, 32) + 0.5 * ts_rank_cd(${PROBLEM_TSV}, ${anyTerms(text)}, 32))`
      : Prisma.sql`0`;
    return this.prisma.$queryRaw<ProjectRow[]>(Prisma.sql`
      SELECT r.id, r."roomId", r."name", r."description", r."status"::text AS status,
             p."publicId" AS "problemPublicId", p."title" AS "problemTitle",
             ao."name" AS "organizationName", go."name" AS "governmentName",
             ${rank}::float8 AS rank
      FROM resolution_projects r
      JOIN problems p ON p.id = r."problemId"
      JOIN organizations ao ON ao.id = r."assignedOrganizationId"
      JOIN organizations go ON go.id = r."governmentOrganizationId"
      WHERE ${Prisma.join(conditions, ' AND ')}
      ORDER BY rank DESC, r."updatedAt" DESC, r.id
      LIMIT ${ids ? ids.length : this.config.search.candidateLimit}
    `);
  }
}
