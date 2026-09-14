import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiService, EmbeddingOutcome } from '../../ai/ai.service.js';
import type { AppConfig, DuplicateDetectionConfig } from '../../config/app.config.js';
import type { PrismaService } from '../../database/prisma.service.js';
import {
  DuplicateDetectionService,
  buildCanonicalText,
  isHumanReviewed,
} from './duplicate-detection.service.js';
import { DuplicateScoringService } from './duplicate-scoring.service.js';

const CONFIG: DuplicateDetectionConfig = {
  geoRadiusMeters: 750,
  maxDistanceMeters: 5000,
  geoGateFloor: 0.25,
  categoryGateFloor: 0.4,
  candidateLimit: 20,
  resultLimit: 5,
  minTextSimilarity: 0.35,
  weights: { text: 0.35, image: 0.25, geographic: 0.25, category: 0.1, temporal: 0.05 },
  highThreshold: 0.85,
  possibleThreshold: 0.65,
  relatedThreshold: 0.5,
  temporalHalfLifeDays: 120,
  temporalFloor: 0.35,
};

const PROBLEM = {
  id: 'prb-new',
  publicId: 'SAM-2',
  title: 'Large pothole near Sector 12 market',
  description: 'A deep pothole has opened at the market entrance.',
  category: 'POTHOLES',
  subcategory: 'Road surface failure',
  city: 'Gurugram',
  state: 'Haryana',
  createdAt: new Date('2026-09-13T00:00:00Z'),
};

/** A 384-wide unit vector, the width the column declares. */
const VECTOR = Array.from({ length: 384 }, (_, index) => (index === 0 ? 1 : 0));

const EMBEDDINGS: EmbeddingOutcome = {
  ok: true,
  embeddings: {
    vectors: [VECTOR],
    provider: 'sentence-transformers',
    modelName: 'sentence-transformers/all-MiniLM-L6-v2',
    modelVersion: 'sentence-transformers/6.0.1',
    dimensions: 384,
    normalized: true,
    processingMs: 40,
  },
};

function createFakePrisma(candidateRows: Array<Record<string, unknown>> = []) {
  const jobs: Array<Record<string, unknown>> = [];
  const pairs: Array<Record<string, unknown>> = [];
  const embeddingWrites: unknown[][] = [];

  return {
    jobs,
    pairs,
    embeddingWrites,
    problem: {
      findFirst: vi.fn(async () => PROBLEM),
      update: vi.fn(async () => PROBLEM),
    },
    problemAiAnalysis: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: `job-${jobs.length + 1}`,
          ...data,
          errorMessage: null,
          rawResult: null,
          updatedAt: new Date(),
          history: [data.processingStatus],
        };
        jobs.push(row);
        return row;
      }),
      updateMany: vi.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const row = jobs.find((entry) => entry.id === where.id);
          // Mirrors Prisma: `updateMany` reports a count, it does not throw.
          if (!row) return { count: 0 };
          if (data.processingStatus) {
            (row.history as string[]).push(data.processingStatus as string);
          }
          Object.assign(row, data);
          return { count: 1 };
        },
      ),
      findFirst: vi.fn(async () => null),
    },
    problemDuplicateCandidate: {
      findUnique: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
      deleteMany: vi.fn(async () => ({ count: 0 })),
      upsert: vi.fn(async ({ create }: { create: Record<string, unknown> }) => {
        pairs.push(create);
        return create;
      }),
      update: vi.fn(async () => ({})),
    },
    auditLog: { create: vi.fn(async () => ({})) },
    $executeRaw: vi.fn(async (...args: unknown[]) => {
      embeddingWrites.push(args);
      return 1;
    }),
    $queryRaw: vi.fn(async () => candidateRows),
  };
}

function build(prisma: ReturnType<typeof createFakePrisma>, outcome: EmbeddingOutcome) {
  const embedText = vi.fn(async () => outcome);
  const ai = { embedText } as unknown as AiService;
  const config = { duplicateDetection: CONFIG } as unknown as AppConfig;

  const service = new DuplicateDetectionService(
    prisma as unknown as PrismaService,
    ai,
    new DuplicateScoringService(),
    config,
  );

  return { service, embedText };
}

/** Lets the detached run settle. */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(5000);
}

function candidateRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'prb-old',
    publicId: 'SAM-1',
    title: 'Huge pothole outside the Sector 12 market',
    category: 'POTHOLES',
    subcategory: 'Road surface failure',
    status: 'SUBMITTED',
    city: 'Gurugram',
    createdAt: new Date('2026-09-11T00:00:00Z'),
    voteCount: 12,
    textSimilarity: 0.91,
    distanceMeters: 45,
    ...overrides,
  };
}

describe('DuplicateDetectionService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('records the check as a DUPLICATE_ANALYSIS job', async () => {
    const prisma = createFakePrisma();
    const { service } = build(prisma, EMBEDDINGS);

    await service.enqueue('prb-new');
    await settle();

    expect(prisma.jobs[0]).toMatchObject({
      problemId: 'prb-new',
      analysisType: 'DUPLICATE_ANALYSIS',
    });
  });

  it('transitions PENDING -> PROCESSING -> COMPLETED', async () => {
    const prisma = createFakePrisma([candidateRow()]);
    const { service } = build(prisma, EMBEDDINGS);

    await service.enqueue('prb-new');
    await settle();

    expect(prisma.jobs[0]?.history).toEqual(['PENDING', 'PROCESSING', 'COMPLETED']);
  });

  it('stores the embedding before searching', async () => {
    const prisma = createFakePrisma([candidateRow()]);
    const { service } = build(prisma, EMBEDDINGS);

    await service.enqueue('prb-new');
    await settle();

    expect(prisma.$executeRaw).toHaveBeenCalledOnce();
    expect(prisma.$queryRaw).toHaveBeenCalledOnce();
  });

  it('persists a scored candidate pair', async () => {
    const prisma = createFakePrisma([candidateRow()]);
    const { service } = build(prisma, EMBEDDINGS);

    await service.enqueue('prb-new');
    await settle();

    expect(prisma.pairs).toHaveLength(1);
    expect(prisma.pairs[0]).toMatchObject({
      problemId: 'prb-new',
      candidateProblemId: 'prb-old',
      status: 'LIKELY_DUPLICATE',
    });
    expect(Number(prisma.pairs[0]?.combinedScore)).toBeGreaterThan(0.85);
  });

  /**
   * The guarantee the whole design rests on: the detector's ceiling is
   * `LIKELY_DUPLICATE`. `CONFIRMED_DUPLICATE` records a human decision and
   * nothing on the scoring path may write it.
   */
  it('never writes CONFIRMED_DUPLICATE from scoring', async () => {
    const prisma = createFakePrisma([
      candidateRow({ textSimilarity: 1, distanceMeters: 0 }),
    ]);
    const { service } = build(prisma, EMBEDDINGS);

    await service.enqueue('prb-new');
    await settle();

    expect(prisma.pairs[0]?.status).toBe('LIKELY_DUPLICATE');
    expect(prisma.pairs.map((pair) => pair.status)).not.toContain('CONFIRMED_DUPLICATE');
  });

  it('stores nothing when no candidate clears the threshold', async () => {
    const prisma = createFakePrisma([
      candidateRow({ textSimilarity: 0.36, distanceMeters: 4800, category: 'GARBAGE' }),
    ]);
    const { service } = build(prisma, EMBEDDINGS);

    await service.enqueue('prb-new');
    await settle();

    expect(prisma.pairs).toHaveLength(0);
    // Still a completed check, not a failed one — "nothing similar" is a result.
    expect(prisma.jobs[0]?.processingStatus).toBe('COMPLETED');
  });

  it('completes cleanly when the search returns nothing at all', async () => {
    const prisma = createFakePrisma([]);
    const { service } = build(prisma, EMBEDDINGS);

    await service.enqueue('prb-new');
    await settle();

    expect(prisma.jobs[0]).toMatchObject({
      processingStatus: 'COMPLETED',
      rawResult: expect.objectContaining({ comparedCount: 0, keptCount: 0 }),
    });
  });

  it('ranks candidates deterministically', async () => {
    const rows = [
      candidateRow({ id: 'a', publicId: 'SAM-A', textSimilarity: 0.7 }),
      candidateRow({ id: 'b', publicId: 'SAM-B', textSimilarity: 0.95 }),
      candidateRow({ id: 'c', publicId: 'SAM-C', textSimilarity: 0.8 }),
    ];

    const first = createFakePrisma(rows);
    const second = createFakePrisma([...rows].reverse());

    const one = build(first, EMBEDDINGS);
    const two = build(second, EMBEDDINGS);

    await one.service.enqueue('prb-new');
    await settle();
    await two.service.enqueue('prb-new');
    await settle();

    const order = (prisma: typeof first) =>
      prisma.pairs.map((pair) => pair.candidateProblemId);

    expect(order(first)).toEqual(['b', 'c', 'a']);
    // Input order must not change output order.
    expect(order(second)).toEqual(order(first));
  });

  it('keeps at most the configured number of results', async () => {
    const rows = Array.from({ length: 12 }, (_, index) =>
      candidateRow({ id: `p-${index}`, publicId: `SAM-${index}`, textSimilarity: 0.9 }),
    );
    const prisma = createFakePrisma(rows);
    const { service } = build(prisma, EMBEDDINGS);

    await service.enqueue('prb-new');
    await settle();

    expect(prisma.pairs).toHaveLength(CONFIG.resultLimit);
  });

  // Re-checking must retract what it no longer believes, or the list only grows.
  it('retracts candidates a re-check no longer supports', async () => {
    const prisma = createFakePrisma([candidateRow()]);
    const { service } = build(prisma, EMBEDDINGS);

    await service.enqueue('prb-new');
    await settle();

    const [args] = (prisma.problemDuplicateCandidate.deleteMany as any).mock.calls[0];
    expect(args.where.candidateProblemId.notIn).toEqual(['prb-old']);
    // A person's verdict is not the algorithm's to withdraw.
    expect(args.where.status.notIn).toEqual([
      'CONFIRMED_DUPLICATE',
      'REJECTED',
      'NOT_DUPLICATE',
    ]);
  });

  it('leaves a human-reviewed pair untouched when re-scoring', async () => {
    const prisma = createFakePrisma([candidateRow()]);
    prisma.problemDuplicateCandidate.findUnique = vi.fn(async () => ({
      id: 'pair-1',
      status: 'REJECTED',
    })) as never;
    const { service } = build(prisma, EMBEDDINGS);

    await service.enqueue('prb-new');
    await settle();

    expect(prisma.problemDuplicateCandidate.upsert).not.toHaveBeenCalled();
  });

  // =============================================================== failures

  it('marks the check FAILED when encoding fails, without touching the problem', async () => {
    const prisma = createFakePrisma();
    const { service } = build(prisma, {
      ok: false,
      failure: {
        code: 'PROVIDER_UNAVAILABLE',
        message: 'The analysis service could not be reached.',
        retryable: false,
      },
    });

    await service.enqueue('prb-new');
    await settle();

    expect(prisma.jobs[0]).toMatchObject({
      processingStatus: 'FAILED',
      errorMessage: 'The analysis service could not be reached.',
    });
    // The civic report is the thing of value; a failed check cannot harm it.
    expect(prisma.problem.update).not.toHaveBeenCalled();
    expect(prisma.pairs).toHaveLength(0);
  });

  it('fails the check rather than crashing when the problem is gone', async () => {
    const prisma = createFakePrisma();
    prisma.problem.findFirst = vi.fn(async () => null) as never;
    const { service, embedText } = build(prisma, EMBEDDINGS);

    await service.enqueue('prb-new');
    await settle();

    expect(embedText).not.toHaveBeenCalled();
    expect(prisma.jobs[0]?.processingStatus).toBe('FAILED');
  });

  it('bounds a stored error message', async () => {
    const prisma = createFakePrisma();
    const { service } = build(prisma, {
      ok: false,
      failure: { code: 'PROVIDER_ERROR', message: 'x'.repeat(2000), retryable: false },
    });

    await service.enqueue('prb-new');
    await settle();

    expect((prisma.jobs[0]!.errorMessage as string).length).toBe(500);
  });

  it('refuses a retry while a check is already running', async () => {
    const prisma = createFakePrisma();
    prisma.problemAiAnalysis.findFirst = vi.fn(async () => ({
      id: 'job-1',
      processingStatus: 'PROCESSING',
    })) as never;
    const { service } = build(prisma, EMBEDDINGS);

    await expect(service.retry('prb-new')).rejects.toThrow(/already running/i);
  });

  // ============================================================== provenance

  it('records the model that produced the check', async () => {
    const prisma = createFakePrisma([candidateRow()]);
    const { service } = build(prisma, EMBEDDINGS);

    await service.enqueue('prb-new');
    await settle();

    expect(prisma.jobs[0]).toMatchObject({
      modelName: 'sentence-transformers/all-MiniLM-L6-v2',
      modelVersion: 'sentence-transformers/6.0.1',
    });
  });

  // Vectors are reconstructable representations of their source text.
  it('never stores a vector in the job result', async () => {
    const prisma = createFakePrisma([candidateRow()]);
    const { service } = build(prisma, EMBEDDINGS);

    await service.enqueue('prb-new');
    await settle();

    const serialised = JSON.stringify(prisma.jobs[0]?.rawResult);
    expect(serialised).not.toContain('embedding');
    expect(serialised).not.toContain('vector');
    expect(prisma.jobs[0]?.rawResult).toMatchObject({
      provider: 'sentence-transformers',
      comparedCount: 1,
      keptCount: 1,
    });
  });
});

describe('buildCanonicalText', () => {
  const problem = {
    title: 'Broken streetlight near Sector 12',
    description: 'Streetlight has not been working for two weeks.',
    category: 'STREETLIGHTS',
    subcategory: 'Non-functioning lamp',
    city: 'Gurugram',
    state: 'Haryana',
  };

  it('includes what describes the civic problem', () => {
    const text = buildCanonicalText(problem);

    expect(text).toContain('Broken streetlight near Sector 12');
    expect(text).toContain('not been working for two weeks');
    expect(text).toContain('STREETLIGHTS');
    expect(text).toContain('Non-functioning lamp');
    expect(text).toContain('Gurugram, Haryana');
  });

  /**
   * An embedding reconstructs its input well enough that anything included here
   * is effectively retained in a form similarity search can surface. Only the
   * problem goes in — never the person who reported it.
   */
  it('excludes everything personal', () => {
    // Fields a careless refactor might pass through.
    const text = buildCanonicalText({
      ...problem,
      reporterId: 'user-123',
      reporterEmail: 'citizen@example.com',
      phone: '+91 99999 99999',
    } as Parameters<typeof buildCanonicalText>[0]);

    expect(text).not.toContain('user-123');
    expect(text).not.toContain('citizen@example.com');
    expect(text).not.toContain('99999');
  });

  it('omits coordinates, which the geographic signal measures far better', () => {
    const text = buildCanonicalText({
      ...problem,
      latitude: 28.4595,
    } as Parameters<typeof buildCanonicalText>[0]);

    expect(text).not.toContain('28.4595');
  });

  it('handles a problem with no subcategory or locality', () => {
    const text = buildCanonicalText({
      ...problem,
      subcategory: null,
      city: null,
      state: null,
    });

    expect(text).toContain('Broken streetlight near Sector 12');
    expect(text).not.toContain('Issue:');
  });
});

describe('isHumanReviewed', () => {
  it('recognises the statuses a person sets', () => {
    expect(isHumanReviewed('CONFIRMED_DUPLICATE')).toBe(true);
    expect(isHumanReviewed('REJECTED')).toBe(true);
    expect(isHumanReviewed('NOT_DUPLICATE')).toBe(true);
  });

  it('does not treat the algorithm’s own verdicts as reviewed', () => {
    expect(isHumanReviewed('PENDING')).toBe(false);
    expect(isHumanReviewed('LIKELY_DUPLICATE')).toBe(false);
  });
});
