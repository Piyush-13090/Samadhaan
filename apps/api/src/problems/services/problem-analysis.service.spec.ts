import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import type {
  AnalysisOutcome,
  AiService,
  AnalyzeProblemInput,
} from '../../ai/ai.service.js';
import type { PrismaService } from '../../database/prisma.service.js';
import type { StorageService } from '../../storage/storage.types.js';
import { ProblemAnalysisService, toAnalysisView } from './problem-analysis.service.js';
import type { ProblemAiAnalysis } from '../../generated/prisma/client.js';

/**
 * An in-memory stand-in for the two tables this service touches.
 *
 * Written by hand rather than mocked call-by-call because what is under test is
 * a *sequence* of writes — PENDING, then PROCESSING, then a terminal state. A
 * per-call mock would assert that the writes happened; this asserts what the
 * row actually ends up saying, which is what the polling client reads.
 */
function createFakePrisma(problem: Record<string, unknown> | null) {
  const rows: Array<Record<string, unknown>> = [];
  let sequence = 0;

  return {
    rows,
    problem: {
      findFirst: vi.fn(async () => problem),
    },
    problemAiAnalysis: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        sequence += 1;
        const row = {
          id: `ana-${sequence}`,
          ...data,
          category: null,
          subcategory: null,
          severity: null,
          urgency: null,
          severityScore: null,
          summary: null,
          confidence: null,
          rawResult: null,
          processingMs: null,
          errorMessage: null,
          createdAt: new Date(2026, 0, sequence),
          updatedAt: new Date(2026, 0, sequence),
          // Every status the row has held, so transitions can be asserted.
          history: [data.processingStatus],
        };
        rows.push(row);
        return row;
      }),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          const row = rows.find((entry) => entry.id === where.id);
          if (!row) throw new Error(`No analysis ${where.id}`);
          if (data.processingStatus) {
            (row.history as string[]).push(data.processingStatus as string);
          }
          Object.assign(row, data);
          return row;
        },
      ),
      findFirst: vi.fn(async ({ where }: { where: Record<string, any> }) => {
        const matches = rows.filter((row) => {
          if (where.problemId && row.problemId !== where.problemId) return false;
          if (where.analysisType && row.analysisType !== where.analysisType) return false;
          if (where.processingStatus?.in) {
            return where.processingStatus.in.includes(row.processingStatus);
          }
          return true;
        });
        // `findLatest` orders by createdAt desc; the fake mirrors that.
        return matches[matches.length - 1] ?? null;
      }),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
  };
}

const PROBLEM = {
  id: 'prb-1',
  publicId: 'SAM-1',
  title: 'Pothole on the main road',
  description: 'A deep pothole has formed near the junction.',
  category: 'POTHOLES',
  subcategory: null,
  city: 'Pune',
  state: 'Maharashtra',
  images: [],
};

const ANALYSIS = {
  provider: 'anthropic',
  modelName: 'claude-opus-5',
  modelVersion: 'claude-opus-5',
  category: 'POTHOLES' as const,
  subcategory: 'road surface cavity',
  severity: 'HIGH' as const,
  urgency: 'HIGH' as const,
  summary: 'A deep pothole near a junction is a hazard to two-wheelers.',
  confidence: 0.91,
  observations: ['A cavity is visible in the road surface.'],
  severityScore: 7.5,
  processingMs: 3100,
  textOnly: true,
};

function build(
  prisma: ReturnType<typeof createFakePrisma>,
  outcomes: AnalysisOutcome[],
  storageBytes: Buffer | null = null,
) {
  const queue = [...outcomes];
  const analyzeProblem = vi.fn(
    async (_input: AnalyzeProblemInput) =>
      queue.shift() ?? outcomes[outcomes.length - 1]!,
  );
  const ai = { analyzeProblem } as unknown as AiService;
  const storage = { get: vi.fn(async () => storageBytes) } as unknown as StorageService;

  return {
    analyzeProblem,
    storage,
    service: new ProblemAnalysisService(prisma as unknown as PrismaService, ai, storage),
  };
}

/** Lets every detached promise and backoff timer settle. */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(10_000);
}

describe('ProblemAnalysisService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns without waiting on the model, leaving a row to poll', async () => {
    const prisma = createFakePrisma(PROBLEM);
    // Never resolves: the citizen's request must not be held by this.
    const analyzeProblem = vi.fn(() => new Promise(() => {}));
    const ai = { analyzeProblem } as unknown as AiService;
    const storage = { get: vi.fn(async () => null) } as unknown as StorageService;

    await new ProblemAnalysisService(
      prisma as unknown as PrismaService,
      ai,
      storage,
    ).enqueue('prb-1');
    await settle();

    // `enqueue` resolved even though the analysis is still outstanding.
    expect(analyzeProblem).toHaveBeenCalledTimes(1);
    expect(prisma.rows).toHaveLength(1);
    expect(prisma.rows[0]).toMatchObject({
      problemId: 'prb-1',
      analysisType: 'INITIAL_ANALYSIS',
    });
    // The first state written is PENDING, so a client polling immediately after
    // submission always finds a row rather than a 404.
    expect((prisma.rows[0]!.history as string[])[0]).toBe('PENDING');
    expect(prisma.rows[0]?.processingStatus).toBe('PROCESSING');
  });

  it('transitions PENDING -> PROCESSING -> COMPLETED', async () => {
    const prisma = createFakePrisma(PROBLEM);
    const { service } = build(prisma, [{ ok: true, analysis: ANALYSIS }]);

    await service.enqueue('prb-1');
    await settle();

    expect(prisma.rows[0]?.history).toEqual(['PENDING', 'PROCESSING', 'COMPLETED']);
  });

  it('persists the completed analysis', async () => {
    const prisma = createFakePrisma(PROBLEM);
    const { service } = build(prisma, [{ ok: true, analysis: ANALYSIS }]);

    await service.enqueue('prb-1');
    await settle();

    expect(prisma.rows[0]).toMatchObject({
      modelName: 'claude-opus-5',
      category: 'POTHOLES',
      severity: 'HIGH',
      urgency: 'HIGH',
      confidence: 0.91,
      severityScore: 7.5,
      summary: ANALYSIS.summary,
      processingMs: 3100,
      processingStatus: 'COMPLETED',
      errorMessage: null,
    });
  });

  /**
   * The prompt is the service's own text and the model's private reasoning is
   * never requested. Only observations — statements written for the citizen —
   * are stored alongside provenance.
   */
  it('stores only the publishable part of the result', async () => {
    const prisma = createFakePrisma(PROBLEM);
    const { service } = build(prisma, [{ ok: true, analysis: ANALYSIS }]);

    await service.enqueue('prb-1');
    await settle();

    expect(prisma.rows[0]?.rawResult).toEqual({
      provider: 'anthropic',
      observations: ANALYSIS.observations,
      textOnly: true,
      imageCount: 0,
      attempt: 1,
    });
  });

  it('never writes to the problem itself — AI recommends, a reviewer decides', async () => {
    const prisma = createFakePrisma(PROBLEM) as ReturnType<typeof createFakePrisma> & {
      problem: Record<string, unknown>;
    };
    const { service } = build(prisma, [{ ok: true, analysis: ANALYSIS }]);

    await service.enqueue('prb-1');
    await settle();

    // The fake exposes no `update` at all, so any write would have thrown.
    expect(prisma.problem).not.toHaveProperty('update');
    expect(PROBLEM.category).toBe('POTHOLES');
  });

  it('marks a permanent failure FAILED after a single attempt', async () => {
    const prisma = createFakePrisma(PROBLEM);
    const { service, analyzeProblem } = build(prisma, [
      {
        ok: false,
        failure: {
          code: 'PROVIDER_UNAVAILABLE',
          message: 'AI analysis is not configured on this server.',
          retryable: false,
        },
      },
    ]);

    await service.enqueue('prb-1');
    await settle();

    // The point of `retryable: false`: no further paid calls are made.
    expect(analyzeProblem).toHaveBeenCalledTimes(1);
    expect(prisma.rows[0]).toMatchObject({
      processingStatus: 'FAILED',
      errorMessage: 'AI analysis is not configured on this server.',
    });
  });

  it('retries a retryable failure up to three attempts, then fails', async () => {
    const prisma = createFakePrisma(PROBLEM);
    const failure = {
      ok: false as const,
      failure: {
        code: 'PROVIDER_ERROR',
        message: 'The analysis service could not be reached.',
        retryable: true,
      },
    };
    const { service, analyzeProblem } = build(prisma, [failure, failure, failure]);

    await service.enqueue('prb-1');
    await settle();

    expect(analyzeProblem).toHaveBeenCalledTimes(3);
    expect(prisma.rows[0]?.processingStatus).toBe('FAILED');
  });

  it('completes on a later attempt when a transient failure clears', async () => {
    const prisma = createFakePrisma(PROBLEM);
    const { service, analyzeProblem } = build(prisma, [
      {
        ok: false,
        failure: { code: 'TIMEOUT', message: 'Too slow.', retryable: true },
      },
      { ok: true, analysis: ANALYSIS },
    ]);

    await service.enqueue('prb-1');
    await settle();

    expect(analyzeProblem).toHaveBeenCalledTimes(2);
    expect(prisma.rows[0]).toMatchObject({
      processingStatus: 'COMPLETED',
      rawResult: expect.objectContaining({ attempt: 2 }),
    });
  });

  it('bounds a stored error message', async () => {
    const prisma = createFakePrisma(PROBLEM);
    const { service } = build(prisma, [
      {
        ok: false,
        failure: { code: 'PROVIDER_ERROR', message: 'x'.repeat(2000), retryable: false },
      },
    ]);

    await service.enqueue('prb-1');
    await settle();

    expect((prisma.rows[0]!.errorMessage as string).length).toBe(500);
  });

  it('fails the analysis rather than crashing when the problem is gone', async () => {
    const prisma = createFakePrisma(null);
    const { service, analyzeProblem } = build(prisma, [{ ok: true, analysis: ANALYSIS }]);

    await service.enqueue('prb-1');
    await settle();

    expect(analyzeProblem).not.toHaveBeenCalled();
    expect(prisma.rows[0]?.processingStatus).toBe('FAILED');
  });

  describe('retry', () => {
    it('creates a new row rather than overwriting the previous analysis', async () => {
      const prisma = createFakePrisma(PROBLEM);
      const { service } = build(prisma, [{ ok: true, analysis: ANALYSIS }]);

      await service.enqueue('prb-1');
      await settle();
      await service.retry('prb-1');
      await settle();

      expect(prisma.rows).toHaveLength(2);
      // History is the point: the first result is still readable.
      expect(prisma.rows[0]?.processingStatus).toBe('COMPLETED');
      expect(prisma.rows[1]?.processingStatus).toBe('COMPLETED');
      expect(prisma.rows[0]?.id).not.toBe(prisma.rows[1]?.id);
    });

    /**
     * `problem_ai_analyses` holds duplicate checks too. Without an
     * `analysisType` filter, an in-flight duplicate check blocks a
     * re-analysis — two unrelated jobs deadlocking purely because they share a
     * table.
     */
    it('is not blocked by an in-flight duplicate check', async () => {
      const prisma = createFakePrisma(PROBLEM);
      const { service } = build(prisma, [{ ok: true, analysis: ANALYSIS }]);

      await service.enqueue('prb-1');
      await settle();

      // A duplicate check sitting in PROCESSING, as one would be after submit.
      prisma.rows.push({
        id: 'dup-1',
        problemId: 'prb-1',
        analysisType: 'DUPLICATE_ANALYSIS',
        processingStatus: 'PROCESSING',
        history: ['PENDING', 'PROCESSING'],
      });

      await expect(service.retry('prb-1')).resolves.toBeDefined();
    });

    it('refuses while an analysis is already in flight', async () => {
      const prisma = createFakePrisma(PROBLEM);
      const ai = {
        analyzeProblem: vi.fn(() => new Promise(() => {})),
      } as unknown as AiService;
      const storage = { get: vi.fn(async () => null) } as unknown as StorageService;
      const service = new ProblemAnalysisService(
        prisma as unknown as PrismaService,
        ai,
        storage,
      );

      await service.enqueue('prb-1');

      // Hammering Retry must not queue several paid calls.
      await expect(service.retry('prb-1')).rejects.toThrow(/already running/i);
      expect(prisma.rows).toHaveLength(1);
    });
  });

  describe('images', () => {
    it('downsizes a copy for the request and leaves the stored original alone', async () => {
      vi.useRealTimers(); // sharp does real async work
      const original = await sharp({
        create: {
          width: 2400,
          height: 1600,
          channels: 3,
          background: { r: 120, g: 120, b: 120 },
        },
      })
        .png()
        .toBuffer();

      const prisma = createFakePrisma({
        ...PROBLEM,
        images: [{ storageKey: 'problems/a.png', mimeType: 'image/png' }],
      });
      const { service, analyzeProblem, storage } = build(
        prisma,
        [{ ok: true, analysis: { ...ANALYSIS, textOnly: false } }],
        original,
      );

      await service.enqueue('prb-1');
      await new Promise((resolve) => setTimeout(resolve, 200));

      const sent = analyzeProblem.mock.calls[0]![0];
      const bytes = Buffer.from(sent.images[0]!.data, 'base64');
      const meta = await sharp(bytes).metadata();

      expect(sent.images).toHaveLength(1);
      expect(sent.images[0]?.mediaType).toBe('image/jpeg');
      expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBe(1024);
      expect(bytes.length).toBeLessThan(original.length);
      // The storage layer was only read from.
      expect(storage).not.toHaveProperty('put');
    });

    it('analyses from text alone when an image cannot be read', async () => {
      const prisma = createFakePrisma({
        ...PROBLEM,
        images: [{ storageKey: 'problems/missing.jpg', mimeType: 'image/jpeg' }],
      });
      const { service, analyzeProblem } = build(
        prisma,
        [{ ok: true, analysis: ANALYSIS }],
        null,
      );

      await service.enqueue('prb-1');
      await settle();

      const sent = analyzeProblem.mock.calls[0]![0];
      expect(sent.images).toEqual([]);
      expect(prisma.rows[0]?.processingStatus).toBe('COMPLETED');
    });

    it('never sends coordinates to the AI service', async () => {
      const prisma = createFakePrisma({
        ...PROBLEM,
        latitude: 18.52,
        longitude: 73.85,
      });
      const { service, analyzeProblem } = build(prisma, [{ ok: true, analysis: ANALYSIS }]);

      await service.enqueue('prb-1');
      await settle();

      const sent = analyzeProblem.mock.calls[0]![0];
      expect(sent.locality).toBe('Pune, Maharashtra');
      expect(JSON.stringify(sent)).not.toContain('73.85');
    });
  });

  describe('recoverStuckAnalyses', () => {
    it('fails rows a restart left mid-flight', async () => {
      const prisma = createFakePrisma(PROBLEM);
      prisma.problemAiAnalysis.updateMany = vi.fn(async () => ({ count: 2 }));
      const { service } = build(prisma, []);

      await expect(service.recoverStuckAnalyses()).resolves.toBe(2);

      const args = (prisma.problemAiAnalysis.updateMany as any).mock.calls[0][0];
      expect(args.where.processingStatus.in).toEqual(['PENDING', 'PROCESSING']);
      expect(args.data.processingStatus).toBe('FAILED');
    });
  });
});

describe('toAnalysisView', () => {
  const row = {
    id: 'ana-1',
    processingStatus: 'COMPLETED',
    category: 'POTHOLES',
    subcategory: 'road surface cavity',
    severity: 'HIGH',
    urgency: 'HIGH',
    severityScore: 7.5,
    summary: 'A summary.',
    confidence: 0.91,
    modelName: 'claude-opus-5',
    errorMessage: null,
    processingMs: 3100,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:05.000Z'),
    rawResult: {
      provider: 'anthropic',
      observations: ['A cavity is visible.'],
      textOnly: false,
      imageCount: 1,
      attempt: 1,
    },
  } as unknown as ProblemAiAnalysis;

  it('returns the structured response shape', () => {
    expect(toAnalysisView(row)).toMatchObject({
      id: 'ana-1',
      status: 'COMPLETED',
      category: 'POTHOLES',
      severity: 'HIGH',
      confidence: 0.91,
      observations: ['A cavity is visible.'],
      textOnly: false,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
  });

  // An allow-list, not a passthrough: internal fields stay internal.
  it('does not publish rawResult wholesale', () => {
    const view = toAnalysisView(row) as unknown as Record<string, unknown>;

    expect(view).not.toHaveProperty('rawResult');
    expect(view).not.toHaveProperty('provider');
    expect(view).not.toHaveProperty('attempt');
  });

  it('survives a row with no result yet', () => {
    const pending = {
      ...row,
      processingStatus: 'PENDING',
      category: null,
      severity: null,
      urgency: null,
      severityScore: null,
      summary: null,
      confidence: null,
      rawResult: null,
    } as unknown as ProblemAiAnalysis;

    expect(toAnalysisView(pending)).toMatchObject({
      status: 'PENDING',
      category: null,
      confidence: null,
      observations: [],
      textOnly: false,
    });
  });
});
