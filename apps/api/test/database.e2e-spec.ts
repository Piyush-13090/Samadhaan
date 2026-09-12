import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';

/**
 * Schema-level behaviour, exercised against the real database.
 *
 * These assert the guarantees the *database* makes, not the ones application
 * code makes. A constraint that only exists in a DTO is not a constraint —
 * migrations, scripts and psql sessions all bypass it — so each of these
 * attempts the violation directly through Prisma and expects PostgreSQL to
 * refuse it.
 *
 * Requires a migrated database with the development seed applied.
 */
describe('Database schema (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  /** Unique per run so repeated runs never collide. */
  const run = Date.now();
  const created = { userIds: [] as string[], problemIds: [] as string[] };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    // Order matters: children before parents, because the FKs are Restrict.
    await prisma.problemDuplicateCandidate
      .deleteMany({ where: { problemId: { in: created.problemIds } } })
      .catch(() => undefined);
    await prisma.problemComment
      .deleteMany({ where: { problemId: { in: created.problemIds } } })
      .catch(() => undefined);
    await prisma.problem
      .deleteMany({ where: { id: { in: created.problemIds } } })
      .catch(() => undefined);
    await prisma.organizationMember
      .deleteMany({ where: { userId: { in: created.userIds } } })
      .catch(() => undefined);
    await prisma.organization
      .deleteMany({ where: { slug: { contains: `t${run}` } } })
      .catch(() => undefined);
    await prisma.user
      .deleteMany({ where: { id: { in: created.userIds } } })
      .catch(() => undefined);

    await app?.close();
  });

  /** Creates a throwaway user and remembers it for cleanup. */
  async function makeUser(suffix: string) {
    const user = await prisma.user.create({
      data: {
        email: `db-${run}-${suffix}@samadhaan.test`,
        fullName: `Test ${suffix}`,
        passwordHash: 'not-a-real-hash',
      },
    });
    created.userIds.push(user.id);
    return user;
  }

  /** Creates a throwaway problem and remembers it for cleanup. */
  async function makeProblem(
    reporterId: string,
    overrides: Record<string, unknown> = {},
  ) {
    const problem = await prisma.problem.create({
      data: {
        reporterId,
        title: 'Test problem',
        description: 'Created by the schema test suite.',
        category: 'POTHOLES',
        latitude: 28.46,
        longitude: 77.03,
        ...overrides,
      },
    });
    created.problemIds.push(problem.id);
    return problem;
  }

  // ------------------------------------------------------- extensions & types

  describe('PostgreSQL extensions and column types', () => {
    it('has postgis, vector and pg_trgm installed', async () => {
      const rows = await prisma.$queryRaw<Array<{ extname: string }>>`
        SELECT extname FROM pg_extension
        WHERE extname IN ('postgis', 'vector', 'pg_trgm')
      `;

      expect(rows.map((r) => r.extname).sort()).toEqual(['pg_trgm', 'postgis', 'vector']);
    });

    it('stores problem location as a real geography column, not a string', async () => {
      const rows = await prisma.$queryRaw<Array<{ udt_name: string }>>`
        SELECT udt_name FROM information_schema.columns
        WHERE table_name = 'problems' AND column_name = 'location'
      `;

      expect(rows[0]?.udt_name).toBe('geography');
    });

    it('stores embeddings as a real vector column', async () => {
      const rows = await prisma.$queryRaw<Array<{ udt_name: string }>>`
        SELECT udt_name FROM information_schema.columns
        WHERE table_name = 'problem_embeddings' AND column_name = 'embedding'
      `;

      expect(rows[0]?.udt_name).toBe('vector');
    });

    it('has a GiST index on problem location', async () => {
      const rows = await prisma.$queryRaw<Array<{ indexdef: string }>>`
        SELECT indexdef FROM pg_indexes
        WHERE tablename = 'problems' AND indexname = 'problems_location_gist'
      `;

      expect(rows[0]?.indexdef).toContain('gist');
    });

    it('has an HNSW index on the embedding column', async () => {
      const rows = await prisma.$queryRaw<Array<{ indexdef: string }>>`
        SELECT indexdef FROM pg_indexes
        WHERE tablename = 'problem_embeddings'
          AND indexname = 'problem_embeddings_vector_hnsw'
      `;

      expect(rows[0]?.indexdef).toContain('hnsw');
    });
  });

  // ------------------------------------------------------------ publicId

  describe('Problem public identifiers', () => {
    it('assigns a SAM- reference automatically', async () => {
      const user = await makeUser('pubid');
      const problem = await makeProblem(user.id);

      expect(problem.publicId).toMatch(/^SAM-\d+$/);
    });

    it('never repeats a reference, even for simultaneous inserts', async () => {
      const user = await makeUser('concurrent');

      // The sequence is the point: a read-then-write in application code would
      // race here and hand out the same number twice.
      const problems = await Promise.all(
        Array.from({ length: 10 }, () => makeProblem(user.id)),
      );

      const references = new Set(problems.map((p) => p.publicId));
      expect(references.size).toBe(10);
    });
  });

  // --------------------------------------------------------------- geospatial

  describe('Geospatial data', () => {
    it('populates the geography column from latitude and longitude', async () => {
      const user = await makeUser('geo');
      const problem = await makeProblem(user.id, {
        latitude: 28.4595,
        longitude: 77.0266,
      });

      const rows = await prisma.$queryRaw<Array<{ lat: number; lng: number }>>`
        SELECT ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng
        FROM problems WHERE id = ${problem.id}::uuid
      `;

      expect(rows[0]?.lat).toBeCloseTo(28.4595, 4);
      expect(rows[0]?.lng).toBeCloseTo(77.0266, 4);
    });

    it('keeps the geography column in step when coordinates change', async () => {
      const user = await makeUser('geo-update');
      const problem = await makeProblem(user.id, { latitude: 28.46, longitude: 77.03 });

      await prisma.problem.update({
        where: { id: problem.id },
        data: { latitude: 19.076, longitude: 72.8777 },
      });

      const rows = await prisma.$queryRaw<Array<{ lat: number }>>`
        SELECT ST_Y(location::geometry) AS lat FROM problems WHERE id = ${problem.id}::uuid
      `;

      expect(rows[0]?.lat).toBeCloseTo(19.076, 3);
    });

    it('answers a radius query', async () => {
      const user = await makeUser('radius');
      const centre = await makeProblem(user.id, { latitude: 28.46, longitude: 77.03 });
      // Roughly 100 m north.
      await makeProblem(user.id, { latitude: 28.4609, longitude: 77.03 });

      const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT count(*) AS count FROM problems p, problems centre
        WHERE centre.id = ${centre.id}::uuid
          AND p.id <> centre.id
          AND ST_DWithin(p.location, centre.location, 200)
      `;

      expect(Number(rows[0]?.count)).toBeGreaterThanOrEqual(1);
    });

    it('rejects an out-of-range latitude', async () => {
      const user = await makeUser('badlat');

      await expect(makeProblem(user.id, { latitude: 91 })).rejects.toThrow();
    });

    it('rejects an out-of-range longitude', async () => {
      const user = await makeUser('badlng');

      await expect(makeProblem(user.id, { longitude: -181 })).rejects.toThrow();
    });
  });

  // ------------------------------------------------------------- uniqueness

  describe('Uniqueness constraints', () => {
    it('allows only one vote per user per problem', async () => {
      const user = await makeUser('vote');
      const problem = await makeProblem(user.id);

      await prisma.problemVote.create({
        data: { problemId: problem.id, userId: user.id },
      });

      await expect(
        prisma.problemVote.create({ data: { problemId: problem.id, userId: user.id } }),
      ).rejects.toThrow();
    });

    it('allows only one follow per user per problem', async () => {
      const user = await makeUser('follow');
      const problem = await makeProblem(user.id);

      await prisma.problemFollow.create({
        data: { problemId: problem.id, userId: user.id },
      });

      await expect(
        prisma.problemFollow.create({ data: { problemId: problem.id, userId: user.id } }),
      ).rejects.toThrow();
    });

    it('allows only one membership per user per organisation', async () => {
      const user = await makeUser('member');
      const org = await prisma.organization.create({
        data: { name: 'Test Org', slug: `test-org-t${run}`, type: 'NGO' },
      });

      await prisma.organizationMember.create({
        data: { organizationId: org.id, userId: user.id },
      });

      await expect(
        prisma.organizationMember.create({
          data: { organizationId: org.id, userId: user.id },
        }),
      ).rejects.toThrow();
    });

    it('lets one user belong to several organisations', async () => {
      const user = await makeUser('multi-org');

      const [first, second] = await Promise.all([
        prisma.organization.create({
          data: { name: 'Org A', slug: `org-a-t${run}`, type: 'NGO' },
        }),
        prisma.organization.create({
          data: { name: 'Org B', slug: `org-b-t${run}`, type: 'UNIVERSITY' },
        }),
      ]);

      await prisma.organizationMember.create({
        data: { organizationId: first!.id, userId: user.id },
      });
      await prisma.organizationMember.create({
        data: { organizationId: second!.id, userId: user.id, membershipRole: 'ADMIN' },
      });

      const memberships = await prisma.organizationMember.count({
        where: { userId: user.id },
      });
      expect(memberships).toBe(2);
    });

    it('allows at most one primary image per problem', async () => {
      const user = await makeUser('primary-image');
      const problem = await makeProblem(user.id);

      await prisma.problemImage.create({
        data: {
          problemId: problem.id,
          storageKey: `test/${run}/a.jpg`,
          mimeType: 'image/jpeg',
          fileSize: 1000,
          isPrimary: true,
        },
      });

      await expect(
        prisma.problemImage.create({
          data: {
            problemId: problem.id,
            storageKey: `test/${run}/b.jpg`,
            mimeType: 'image/jpeg',
            fileSize: 1000,
            isPrimary: true,
          },
        }),
      ).rejects.toThrow();

      // A second non-primary image is still fine — the index is partial.
      await expect(
        prisma.problemImage.create({
          data: {
            problemId: problem.id,
            storageKey: `test/${run}/c.jpg`,
            mimeType: 'image/jpeg',
            fileSize: 1000,
          },
        }),
      ).resolves.toBeTruthy();
    });

    it('rejects an organisation slug that is not URL-safe', async () => {
      await expect(
        prisma.organization.create({
          data: { name: 'Bad', slug: `Not A Slug ${run}`, type: 'NGO' },
        }),
      ).rejects.toThrow();
    });
  });

  // -------------------------------------------------------- value constraints

  describe('Value constraints', () => {
    it('rejects a negative priority score', async () => {
      const user = await makeUser('priority');

      await expect(makeProblem(user.id, { priorityScore: -1 })).rejects.toThrow();
    });

    it('rejects a non-positive image file size', async () => {
      const user = await makeUser('filesize');
      const problem = await makeProblem(user.id);

      await expect(
        prisma.problemImage.create({
          data: {
            problemId: problem.id,
            storageKey: `test/${run}/zero.jpg`,
            mimeType: 'image/jpeg',
            fileSize: 0,
          },
        }),
      ).rejects.toThrow();
    });

    it('rejects an AI confidence outside 0–1', async () => {
      const user = await makeUser('confidence');
      const problem = await makeProblem(user.id);

      await expect(
        prisma.problemAiAnalysis.create({
          data: {
            problemId: problem.id,
            modelName: 'test',
            modelVersion: '1',
            analysisType: 'INITIAL_ANALYSIS',
            confidence: 1.5,
          },
        }),
      ).rejects.toThrow();
    });

    it('rejects an empty comment body', async () => {
      const user = await makeUser('empty-comment');
      const problem = await makeProblem(user.id);

      await expect(
        prisma.problemComment.create({
          data: { problemId: problem.id, userId: user.id, body: '   ' },
        }),
      ).rejects.toThrow();
    });
  });

  // ------------------------------------------------------ duplicate detection

  describe('Duplicate candidates', () => {
    it('rejects a self-referencing candidate', async () => {
      const user = await makeUser('self-dup');
      const problem = await makeProblem(user.id);

      await expect(
        prisma.problemDuplicateCandidate.create({
          data: { problemId: problem.id, candidateProblemId: problem.id },
        }),
      ).rejects.toThrow();
    });

    it('stores one record per ordered pair', async () => {
      const user = await makeUser('dup-pair');
      const older = await makeProblem(user.id);
      const newer = await makeProblem(user.id);

      await prisma.problemDuplicateCandidate.create({
        data: { problemId: newer.id, candidateProblemId: older.id, combinedScore: 0.9 },
      });

      await expect(
        prisma.problemDuplicateCandidate.create({
          data: { problemId: newer.id, candidateProblemId: older.id },
        }),
      ).rejects.toThrow();
    });

    // Direction is deliberate: the relationship records which report is newer.
    it('permits the reverse direction as a distinct record', async () => {
      const user = await makeUser('dup-reverse');
      const a = await makeProblem(user.id);
      const b = await makeProblem(user.id);

      await prisma.problemDuplicateCandidate.create({
        data: { problemId: a.id, candidateProblemId: b.id },
      });

      await expect(
        prisma.problemDuplicateCandidate.create({
          data: { problemId: b.id, candidateProblemId: a.id },
        }),
      ).resolves.toBeTruthy();
    });

    it('rejects a similarity score outside 0–1', async () => {
      const user = await makeUser('dup-score');
      const a = await makeProblem(user.id);
      const b = await makeProblem(user.id);

      await expect(
        prisma.problemDuplicateCandidate.create({
          data: { problemId: a.id, candidateProblemId: b.id, textSimilarity: 1.4 },
        }),
      ).rejects.toThrow();
    });
  });

  // -------------------------------------------------------------- relations

  describe('Relationships and delete behaviour', () => {
    it('threads comments through parentCommentId', async () => {
      const user = await makeUser('thread');
      const problem = await makeProblem(user.id);

      const parent = await prisma.problemComment.create({
        data: { problemId: problem.id, userId: user.id, body: 'Top level' },
      });

      await prisma.problemComment.create({
        data: {
          problemId: problem.id,
          userId: user.id,
          parentCommentId: parent.id,
          body: 'A reply',
        },
      });

      const withReplies = await prisma.problemComment.findUnique({
        where: { id: parent.id },
        include: { replies: true },
      });

      expect(withReplies?.replies).toHaveLength(1);
      expect(withReplies?.replies[0]?.body).toBe('A reply');
    });

    // Historical integrity: a civic report must outlive its reporter's account.
    it('refuses to delete a user who has reported problems', async () => {
      const user = await makeUser('restrict');
      await makeProblem(user.id);

      await expect(prisma.user.delete({ where: { id: user.id } })).rejects.toThrow();
    });

    it('removes images with their problem', async () => {
      const user = await makeUser('cascade-image');
      const problem = await makeProblem(user.id);

      await prisma.problemImage.create({
        data: {
          problemId: problem.id,
          storageKey: `test/${run}/cascade.jpg`,
          mimeType: 'image/jpeg',
          fileSize: 500,
        },
      });

      await prisma.problem.delete({ where: { id: problem.id } });
      created.problemIds = created.problemIds.filter((id) => id !== problem.id);

      const remaining = await prisma.problemImage.count({
        where: { problemId: problem.id },
      });
      expect(remaining).toBe(0);
    });

    it('loads a problem with every satellite relation', async () => {
      const seeded = await prisma.problem.findFirst({
        where: { publicId: 'SAM-1000' },
        include: {
          reporter: true,
          images: true,
          aiAnalyses: true,
          comments: true,
          suggestions: true,
          votes: true,
          follows: true,
          duplicateMatches: true,
        },
      });

      expect(seeded).not.toBeNull();
      expect(seeded?.reporter.email).toBeTruthy();
      expect(seeded?.images.length).toBeGreaterThan(0);
      expect(seeded?.aiAnalyses.length).toBeGreaterThan(0);
      expect(seeded?.comments.length).toBeGreaterThan(0);
      expect(seeded?.suggestions.length).toBeGreaterThan(0);
      // The newer report points at this one, so it appears as a match.
      expect(seeded?.duplicateMatches.length).toBeGreaterThan(0);
    });

    it('keeps an audit entry when its actor is removed', async () => {
      const user = await makeUser('audit');

      const entry = await prisma.auditLog.create({
        data: {
          actorUserId: user.id,
          action: 'TEST_ACTION',
          entityType: 'Test',
        },
      });

      await prisma.user.delete({ where: { id: user.id } });
      created.userIds = created.userIds.filter((id) => id !== user.id);

      const after = await prisma.auditLog.findUnique({ where: { id: entry.id } });
      expect(after).not.toBeNull();
      expect(after?.actorUserId).toBeNull();

      await prisma.auditLog.delete({ where: { id: entry.id } });
    });
  });
});
