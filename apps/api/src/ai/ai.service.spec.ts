import { describe, expect, it, vi } from 'vitest';
import { err, ok } from '@samadhaan/shared';
import { AiRequestError, type AiClient } from './ai.client.js';
import { AiService } from './ai.service.js';

describe('AiService', () => {
  it('returns the AI service health report when reachable', async () => {
    const client = {
      get: vi.fn(async () => ok({ status: 'ok' })),
    } as unknown as AiClient;

    await expect(new AiService(client).getHealth()).resolves.toEqual({
      status: 'ok',
    });
  });

  it('returns null when the AI service is unreachable, rather than throwing', async () => {
    const client = {
      get: vi.fn(async () => err(new Error('down'))),
    } as unknown as AiClient;

    await expect(new AiService(client).getHealth()).resolves.toBeNull();
  });

  it('forwards the request id to the client', async () => {
    const get = vi.fn(async () => ok({ status: 'ok' }));
    const client = { get } as unknown as AiClient;

    await new AiService(client).getHealth('req-9');

    expect(get).toHaveBeenCalledWith('/health', { requestId: 'req-9' });
  });
});

const INPUT = {
  problemId: 'prb-1',
  publicId: 'SAM-1',
  title: 'Pothole on the main road',
  description: 'A deep pothole has formed near the junction.',
  categoryHint: 'POTHOLES',
  subcategoryHint: null,
  locality: 'Pune, Maharashtra',
  images: [{ mediaType: 'image/jpeg' as const, data: 'AAAA' }],
};

const RESPONSE = {
  problem_id: 'prb-1',
  provider: 'anthropic',
  model_name: 'claude-opus-5',
  model_version: 'claude-opus-5',
  category: 'POTHOLES',
  subcategory: 'road surface cavity',
  severity: 'HIGH',
  urgency: 'HIGH',
  summary: 'A deep pothole near a junction is a hazard to two-wheelers.',
  confidence: 0.91,
  observations: ['A cavity is visible in the road surface.'],
  severity_score: 7.5,
  processing_ms: 3100,
  image_count: 1,
  text_only: false,
};

describe('AiService.analyzeProblem', () => {
  it('returns a validated analysis on success', async () => {
    const post = vi.fn(async () => ok(RESPONSE));
    const outcome = await new AiService({ post } as unknown as AiClient).analyzeProblem(
      INPUT,
    );

    expect(outcome.ok).toBe(true);
    expect(outcome.ok && outcome.analysis).toMatchObject({
      category: 'POTHOLES',
      severity: 'HIGH',
      confidence: 0.91,
      severityScore: 7.5,
      textOnly: false,
    });
  });

  it('sends the request in the AI service wire shape', async () => {
    const post = vi.fn(
      async (_path: string, _body: Record<string, unknown>, _options: unknown) =>
        ok(RESPONSE),
    );
    await new AiService({ post } as unknown as AiClient).analyzeProblem({
      ...INPUT,
      requestId: 'req-1',
    });

    const [path, body, options] = post.mock.calls[0]!;

    expect(path).toBe('/analyze/problem');
    expect(body).toMatchObject({
      problem_id: 'prb-1',
      public_id: 'SAM-1',
      category_hint: 'POTHOLES',
      locality: 'Pune, Maharashtra',
      images: [{ media_type: 'image/jpeg', data: 'AAAA' }],
    });
    // Coordinates never leave the API. Only coarse locality does.
    expect(JSON.stringify(body)).not.toContain('latitude');
    expect(options).toMatchObject({ requestId: 'req-1', timeoutMs: 90_000 });
  });

  /**
   * The AI service validates its own output, so an unusable payload means the
   * contract has drifted. It must be rejected here rather than written.
   */
  it('rejects a response that fails validation', async () => {
    const post = vi.fn(async () => ok({ ...RESPONSE, category: 'ALIEN_INVASION' }));
    const outcome = await new AiService({ post } as unknown as AiClient).analyzeProblem(
      INPUT,
    );

    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.failure).toMatchObject({
      code: 'INVALID_MODEL_OUTPUT',
      retryable: true,
    });
  });

  it('rejects a response whose confidence is out of range', async () => {
    const post = vi.fn(async () => ok({ ...RESPONSE, confidence: 42 }));
    const outcome = await new AiService({ post } as unknown as AiClient).analyzeProblem(
      INPUT,
    );

    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.failure.code).toBe('INVALID_MODEL_OUTPUT');
  });

  it('passes a structured provider failure through unchanged', async () => {
    const post = vi.fn(async () =>
      err(
        new AiRequestError('AI service responded 503', 503, {
          code: 'PROVIDER_UNAVAILABLE',
          message: 'AI analysis is not configured on this server.',
          retryable: false,
        }),
      ),
    );

    const outcome = await new AiService({ post } as unknown as AiClient).analyzeProblem(
      INPUT,
    );

    expect(!outcome.ok && outcome.failure).toEqual({
      code: 'PROVIDER_UNAVAILABLE',
      message: 'AI analysis is not configured on this server.',
      retryable: false,
    });
  });

  it('treats an unstructured 4xx as permanent and a 5xx as retryable', async () => {
    const build = (status: number) =>
      new AiService({
        post: vi.fn(async () => err(new AiRequestError('boom', status, null))),
      } as unknown as AiClient).analyzeProblem(INPUT);

    const client = await build(400);
    const server = await build(502);

    expect(!client.ok && client.failure.retryable).toBe(false);
    expect(!server.ok && server.failure.retryable).toBe(true);
  });

  it('treats an unreachable service as retryable and never throws', async () => {
    const post = vi.fn(async () => err(new Error('ECONNREFUSED')));
    const outcome = await new AiService({ post } as unknown as AiClient).analyzeProblem(
      INPUT,
    );

    expect(!outcome.ok && outcome.failure).toMatchObject({
      code: 'PROVIDER_ERROR',
      retryable: true,
    });
    // Never the raw transport error — that is ours to read, not a citizen's.
    expect(!outcome.ok && outcome.failure.message).not.toContain('ECONNREFUSED');
  });
});
