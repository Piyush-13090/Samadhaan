import { Injectable } from '@nestjs/common';
import {
  SEARCH_MIN_QUERY_LENGTH,
  type SearchSuggestion,
  type SearchSuggestions,
} from '@samadhaan/shared';
import type { RequestUser } from '../auth/auth.types.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { RedisService } from '../redis/redis.service.js';
import { createHash } from 'node:crypto';
import { SearchAuthorizationService } from './search-authorization.service.js';
import { SearchHistoryService } from './search-history.service.js';
import { CATEGORY_TERMS } from './search-query-parser.js';
import { SearchQueryUnderstandingService } from './search-query-understanding.service.js';
import {
  ORGANIZATION_TSV,
  PROBLEM_TSV,
  SOURCE_TITLE_TSV,
  prefixQuery,
} from './search-sql.js';

const PUBLIC_CACHE_SECONDS = 60;
const human = (v: string) => v.charAt(0) + v.slice(1).toLowerCase().replace(/_/g, ' ');

/**
 * Suggestions as the user types (Prompt 25). Cheap by design: indexed
 * prefix full-text matches, the real category taxonomy, known cities and the
 * user's own recent searches. No embeddings and no AI — those run only when a
 * search is submitted. Public parts are cached briefly by prefix; knowledge
 * titles are filtered by the caller's own scope and never cached.
 */
@Injectable()
export class SearchSuggestionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly access: SearchAuthorizationService,
    private readonly understanding: SearchQueryUnderstandingService,
    private readonly history: SearchHistoryService,
  ) {}

  async suggest(raw: string, user: RequestUser): Promise<SearchSuggestions> {
    const q = raw.trim().slice(0, 100);
    if (q.length < SEARCH_MIN_QUERY_LENGTH) {
      const recent = await this.history.recent(user.id);
      return {
        query: q,
        suggestions: recent
          .slice(0, 5)
          .map((r) => ({ kind: 'RECENT', label: r, href: searchHref(r), detail: null })),
      };
    }
    const prefix = prefixQuery(q);
    const [publicPart, knowledge, recent] = await Promise.all([
      this.publicSuggestions(q, prefix),
      this.knowledge(prefix, user),
      this.history.recent(user.id),
    ]);
    const lower = q.toLowerCase();
    const recentMatches: SearchSuggestion[] = recent
      .filter((r) => r.toLowerCase().startsWith(lower) && r.toLowerCase() !== lower)
      .slice(0, 3)
      .map((r) => ({ kind: 'RECENT', label: r, href: searchHref(r), detail: null }));
    return { query: q, suggestions: [...recentMatches, ...publicPart, ...knowledge] };
  }

  private async publicSuggestions(
    q: string,
    prefix: string | null,
  ): Promise<SearchSuggestion[]> {
    const key = `search:suggest:v1:${createHash('sha256').update(q.toLowerCase()).digest('hex')}`;
    const hit = await this.redis.connection.get(key).catch(() => null);
    if (hit) {
      try {
        return JSON.parse(hit) as SearchSuggestion[];
      } catch {
        // rebuild
      }
    }
    const lower = q.toLowerCase();
    const categories = [
      ...new Map(
        CATEGORY_TERMS.filter(
          ([term]) => term.startsWith(lower) || lower.startsWith(term),
        ).map(([, c]) => [c, c]),
      ).values(),
    ]
      .slice(0, 2)
      .map<SearchSuggestion>((c) => ({
        kind: 'CATEGORY',
        label: `${human(c)} problems`,
        href: `/search?type=PROBLEM&category=${c}`,
        detail: 'Category',
      }));
    const cities = [...(await this.understanding.cities()).entries()]
      .filter(([k]) => k.startsWith(lower))
      .slice(0, 2)
      .map<SearchSuggestion>(([, name]) => ({
        kind: 'CITY',
        label: `Problems in ${name}`,
        href: `/search?type=PROBLEM&city=${encodeURIComponent(name)}`,
        detail: 'Place',
      }));

    let problems: SearchSuggestion[] = [];
    let organizations: SearchSuggestion[] = [];
    if (prefix) {
      const tsq = Prisma.sql`to_tsquery('english', ${prefix})`;
      const [p, o] = await Promise.all([
        this.prisma.$queryRaw<
          Array<{ publicId: string; title: string; city: string | null }>
        >(Prisma.sql`
          SELECT p."publicId", p."title", p."city" FROM problems p
          WHERE ${this.access.problemPredicate()}
            AND p."status" NOT IN ('REJECTED','ARCHIVED','DUPLICATE')
            AND ${PROBLEM_TSV} @@ ${tsq}
          ORDER BY ts_rank_cd(${PROBLEM_TSV}, ${tsq}, 32) DESC, p."createdAt" DESC
          LIMIT 4
        `),
        this.prisma.$queryRaw<
          Array<{ slug: string; name: string; type: string }>
        >(Prisma.sql`
          SELECT o.slug, o.name, o."type"::text AS type FROM organizations o
          WHERE ${this.access.organizationPredicate()} AND ${ORGANIZATION_TSV} @@ ${tsq}
          ORDER BY ts_rank_cd(${ORGANIZATION_TSV}, ${tsq}, 32) DESC, o.name
          LIMIT 3
        `),
      ]);
      problems = p.map((r) => ({
        kind: 'PROBLEM',
        label: r.title,
        href: `/problems/${encodeURIComponent(r.publicId)}`,
        detail: [r.publicId, r.city].filter(Boolean).join(' · '),
      }));
      organizations = o.map((r) => ({
        kind: 'ORGANIZATION',
        label: r.name,
        href: `/organizations/${encodeURIComponent(r.slug)}`,
        detail: human(r.type),
      }));
    }
    const out = [...categories, ...problems, ...organizations, ...cities];
    await this.redis.connection
      .set(key, JSON.stringify(out), 'EX', PUBLIC_CACHE_SECONDS)
      .catch(() => undefined);
    return out;
  }

  private async knowledge(
    prefix: string | null,
    user: RequestUser,
  ): Promise<SearchSuggestion[]> {
    if (!prefix) return [];
    const scope = await this.access.knowledgeScope(user, null);
    const rows = await this.prisma.$queryRaw<
      Array<{ id: string; title: string }>
    >(Prisma.sql`
      SELECT s.id, s."title" FROM knowledge_sources s
      WHERE s."status" = 'COMPLETED' AND ${this.access.knowledgePredicate(scope)}
        AND ${SOURCE_TITLE_TSV} @@ to_tsquery('english', ${prefix})
      ORDER BY s."updatedAt" DESC LIMIT 3
    `);
    return rows.map((r) => ({
      kind: 'KNOWLEDGE',
      label: r.title,
      href: `/knowledge/sources/${r.id}`,
      detail: 'Knowledge',
    }));
  }
}

export function searchHref(q: string): string {
  return `/search?q=${encodeURIComponent(q)}`;
}
