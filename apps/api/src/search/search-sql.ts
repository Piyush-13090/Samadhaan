import { Prisma } from '../generated/prisma/client.js';

/**
 * Problems use a stored generated column (Prompt 27), indexed with GIN. Ranking
 * reads it instead of re-computing to_tsvector per matching row. Its weights
 * (title/subcategory A, description B, place C) live in migration
 * 20261017090000_search_vector.
 */
export const PROBLEM_TSV = Prisma.sql`p."searchVector"`;

/**
 * The other full-text expressions (Prompt 25). Each is written exactly as its
 * GIN expression index in prisma/sql/post-migrate.sql, so PostgreSQL can use
 * the index for `@@`. Change both together.
 */
export const SUMMARY_TSV = Prisma.sql`to_tsvector('english', coalesce(a."summary", ''))`;

export const ORGANIZATION_TSV = Prisma.sql`(
  setweight(to_tsvector('english', coalesce(o."name", '')), 'A') ||
  setweight(to_tsvector('english', coalesce(o."description", '')), 'B') ||
  setweight(to_tsvector('simple', coalesce(o."city", '') || ' ' || coalesce(o."state", '')), 'C')
)`;

export const PROJECT_TSV = Prisma.sql`to_tsvector('english', coalesce(r."name", '') || ' ' || coalesce(r."description", ''))`;

export const SOURCE_TITLE_TSV = Prisma.sql`to_tsvector('english', coalesce(s."title", ''))`;

/**
 * Any-term query: a search for "blocked drain sector 12" should find a report
 * that says "drain blocked" without the sector. Relevance then rewards
 * covering more terms. The text is a bound parameter; `plainto_tsquery`
 * ignores operators in it.
 */
export function anyTerms(text: string): Prisma.Sql {
  return Prisma.sql`NULLIF(replace(plainto_tsquery('english', ${text})::text, ' & ', ' | '), '')::tsquery`;
}

/** Prefix match on the last word, for suggestions as the user types. */
export function prefixQuery(text: string): string | null {
  const words = text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 0)
    .slice(0, 6);
  if (words.length === 0) return null;
  // Only letters and digits survive, so the to_tsquery syntax cannot be abused.
  return words.map((w, i) => (i === words.length - 1 ? `${w}:*` : w)).join(' & ');
}

/** Share of the query's terms a document contains (0–1), over a tsvector expression. */
export function coverage(tsv: Prisma.Sql, text: string): Prisma.Sql {
  return Prisma.sql`(
    SELECT CASE WHEN count(*) = 0 THEN 0
           ELSE (count(*) FILTER (WHERE ${tsv} @@ quote_literal(t)::tsquery))::float8 / count(*) END
    FROM unnest(tsvector_to_array(to_tsvector('english', ${text}))) AS t
  )`;
}

/** Effective priority: an official's override, else the AI tier. */
export const EFFECTIVE_TIER = Prisma.sql`COALESCE(
  (SELECT x."priorityTier" FROM problem_priority_overrides x WHERE x."problemId" = p.id),
  p."priorityTier"
)`;

export const TIER_RANK = Prisma.sql`(CASE ${EFFECTIVE_TIER}
  WHEN 'CRITICAL' THEN 4 WHEN 'HIGH' THEN 3 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 1 ELSE 0 END)`;

export const SEVERITY_RANK = Prisma.sql`(CASE p."severity"
  WHEN 'CRITICAL' THEN 4 WHEN 'HIGH' THEN 3 WHEN 'MEDIUM' THEN 2 ELSE 1 END)`;
