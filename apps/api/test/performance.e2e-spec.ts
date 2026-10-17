import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { Prisma } from '../src/generated/prisma/client.js';
import { PROBLEM_TSV, anyTerms } from '../src/search/search-sql.js';

/**
 * Performance regressions (Prompt 27), asserted structurally rather than with
 * timings: wall-clock thresholds are flaky on shared CI machines, but a query
 * that stops using its index, or a generated column that stops tracking its
 * source, is a deterministic failure. The measurements behind each assertion
 * are in docs/PERFORMANCE_AUDIT.md.
 *
 * Requires a migrated database with prisma/sql/post-migrate.sql applied.
 */
describe('Performance guarantees (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const run = Date.now();
  let problemId = '';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    if (problemId) {
      await prisma.problem.delete({ where: { id: problemId } }).catch(() => undefined);
    }
    await app?.close();
  });

  /** EXPLAIN with sequential scans discouraged, so the plan shows whether an index *can* serve the query. */
  const plan = (sql: Prisma.Sql) =>
    prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
      const rows = await tx.$queryRaw<Array<{ 'QUERY PLAN': string }>>(
        Prisma.sql`EXPLAIN ${sql}`,
      );
      return rows.map((r) => r['QUERY PLAN']).join('\n');
    });

  it('serves the city jurisdiction filter from its expression index', async () => {
    // The exact predicate src/government/jurisdiction.ts builds.
    const text = await plan(
      Prisma.sql`SELECT count(*) FROM problems p
                 WHERE p."deletedAt" IS NULL AND lower(p."city") = ANY (${['pune']}::text[])`,
    );
    expect(text).toContain('problems_city_lower');
  });

  it('ranks problems and knowledge chunks on stored full-text vectors', async () => {
    const problems = await plan(
      Prisma.sql`SELECT p.id, ts_rank_cd(${PROBLEM_TSV}, ${anyTerms('drain')}, 32) FROM problems p
                 WHERE ${PROBLEM_TSV} @@ ${anyTerms('drain')}`,
    );
    expect(problems).toContain('problems_search_vector_gin');
    // No per-row to_tsvector left in the plan: the ranking reads the column.
    expect(problems).not.toContain('to_tsvector');

    const chunks = await plan(
      Prisma.sql`SELECT c.id FROM knowledge_chunks c WHERE c."contentVector" @@ ${anyTerms('drain')}`,
    );
    expect(chunks).toContain('knowledge_chunks_content_vector_gin');
  });

  it('keeps generated search vectors in step with the row', async () => {
    const reporter = await prisma.user.findUniqueOrThrow({
      where: { email: 'citizen@samadhaan.dev' },
    });
    const created = await prisma.problem.create({
      data: {
        reporterId: reporter.id,
        title: `Perf guard culvert ${run}`,
        description: 'A blocked culvert floods the lane after every shower of rain.',
        category: 'DRAINAGE',
        city: 'Pune',
        state: 'Maharashtra',
        latitude: 18.52,
        longitude: 73.85,
        status: 'SUBMITTED',
      },
    });
    problemId = created.id;

    const matches = async (term: string) =>
      (
        await prisma.$queryRaw<Array<{ hit: boolean }>>(
          Prisma.sql`SELECT p."searchVector" @@ plainto_tsquery('english', ${term}) AS hit
                     FROM problems p WHERE p.id = ${problemId}::uuid`,
        )
      )[0]?.hit;

    expect(await matches('culvert')).toBe(true);
    await prisma.problem.update({
      where: { id: problemId },
      data: { title: `Perf guard footbridge ${run}` },
    });
    expect(await matches('footbridge')).toBe(true);
    expect(await matches('culvert')).toBe(true); // still in the description
    expect(await matches('streetlight')).toBe(false);
  });

  it('keeps knowledge embeddings in the main row instead of TOAST', async () => {
    const [row] = await prisma.$queryRaw<Array<{ attstorage: string }>>`
      SELECT attstorage::text AS attstorage FROM pg_attribute
      WHERE attrelid = 'knowledge_chunks'::regclass AND attname = 'embedding'`;
    expect(row?.attstorage).toBe('m');
  });
});
