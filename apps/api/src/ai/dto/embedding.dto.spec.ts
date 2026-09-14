import { describe, expect, it } from 'vitest';
import { EMBEDDING_DIMENSIONS } from '@samadhaan/shared';
import { parseEmbeddingResponse } from './embedding.dto.js';

/** A deterministic unit vector of the given width. */
function vector(width = EMBEDDING_DIMENSIONS, seed = 1): number[] {
  const raw = Array.from({ length: width }, (_, index) => seed + index);
  const norm = Math.hypot(...raw);
  return raw.map((value) => value / norm);
}

function response(overrides: Record<string, unknown> = {}) {
  return {
    embeddings: [{ index: 0, embedding: vector() }],
    provider: 'sentence-transformers',
    model_name: 'sentence-transformers/all-MiniLM-L6-v2',
    model_version: 'sentence-transformers/6.0.1',
    dimensions: EMBEDDING_DIMENSIONS,
    normalized: true,
    processing_ms: 41,
    ...overrides,
  };
}

/**
 * The second of two independent validations. The AI service validates its own
 * output, but this process performs the database write — and pgvector would
 * reject a mis-shaped vector with a message about a column, not about a model.
 */
describe('parseEmbeddingResponse', () => {
  it('accepts a valid response and converts it', () => {
    const result = parseEmbeddingResponse(response(), 1);

    expect(result).toMatchObject({
      provider: 'sentence-transformers',
      modelName: 'sentence-transformers/all-MiniLM-L6-v2',
      modelVersion: 'sentence-transformers/6.0.1',
      dimensions: EMBEDDING_DIMENSIONS,
      normalized: true,
      processingMs: 41,
    });
    expect(result?.vectors).toHaveLength(1);
    expect(result?.vectors[0]).toHaveLength(EMBEDDING_DIMENSIONS);
  });

  /**
   * A vector of the wrong width is not "slightly wrong" — it is incomparable
   * with the entire existing corpus.
   */
  it('rejects a vector of the wrong width', () => {
    expect(
      parseEmbeddingResponse(
        response({ embeddings: [{ index: 0, embedding: vector(128) }] }),
        1,
      ),
    ).toBeNull();
  });

  it('rejects a declared dimension that does not match the column', () => {
    expect(parseEmbeddingResponse(response({ dimensions: 1536 }), 1)).toBeNull();
    expect(parseEmbeddingResponse(response({ dimensions: 0 }), 1)).toBeNull();
  });

  /**
   * The failure that still looks well-formed all the way to the database:
   * every vector silently attached to the wrong text.
   */
  it('rejects a count that does not match the request', () => {
    expect(parseEmbeddingResponse(response(), 2)).toBeNull();

    const two = response({
      embeddings: [
        { index: 0, embedding: vector() },
        { index: 1, embedding: vector(EMBEDDING_DIMENSIONS, 7) },
      ],
    });
    expect(parseEmbeddingResponse(two, 1)).toBeNull();
    expect(parseEmbeddingResponse(two, 2)).not.toBeNull();
  });

  // Order is taken from the reported index, not from array position.
  it('orders vectors by their reported index', () => {
    const a = vector(EMBEDDING_DIMENSIONS, 1);
    const b = vector(EMBEDDING_DIMENSIONS, 7);

    const result = parseEmbeddingResponse(
      response({
        embeddings: [
          { index: 1, embedding: b },
          { index: 0, embedding: a },
        ],
      }),
      2,
    );

    expect(result?.vectors[0]).toEqual(a);
    expect(result?.vectors[1]).toEqual(b);
  });

  it('rejects a gap or duplicate in the indices', () => {
    expect(
      parseEmbeddingResponse(
        response({
          embeddings: [
            { index: 0, embedding: vector() },
            { index: 2, embedding: vector() },
          ],
        }),
        2,
      ),
    ).toBeNull();

    expect(
      parseEmbeddingResponse(
        response({
          embeddings: [
            { index: 0, embedding: vector() },
            { index: 0, embedding: vector() },
          ],
        }),
        2,
      ),
    ).toBeNull();
  });

  it('rejects a vector containing a non-finite value', () => {
    const broken = vector();
    broken[3] = Number.NaN;
    expect(
      parseEmbeddingResponse(response({ embeddings: [{ index: 0, embedding: broken }] }), 1),
    ).toBeNull();

    const infinite = vector();
    infinite[3] = Number.POSITIVE_INFINITY;
    expect(
      parseEmbeddingResponse(
        response({ embeddings: [{ index: 0, embedding: infinite }] }),
        1,
      ),
    ).toBeNull();
  });

  it('rejects a vector containing a non-numeric value', () => {
    const broken: unknown[] = vector();
    broken[3] = '0.5';
    expect(
      parseEmbeddingResponse(response({ embeddings: [{ index: 0, embedding: broken }] }), 1),
    ).toBeNull();
  });

  /**
   * Provenance is not optional. Without it, a later comparison cannot tell
   * whether two vectors came from the same model — and a cosine across two
   * models is a plausible-looking number with no meaning.
   */
  it('rejects a response missing its model provenance', () => {
    expect(parseEmbeddingResponse(response({ model_name: '' }), 1)).toBeNull();
    expect(parseEmbeddingResponse(response({ model_version: '   ' }), 1)).toBeNull();
    expect(parseEmbeddingResponse(response({ provider: null }), 1)).toBeNull();
  });

  it('rejects a malformed body', () => {
    expect(parseEmbeddingResponse(null, 1)).toBeNull();
    expect(parseEmbeddingResponse('ok', 1)).toBeNull();
    expect(parseEmbeddingResponse([], 1)).toBeNull();
    expect(parseEmbeddingResponse({}, 1)).toBeNull();
    expect(parseEmbeddingResponse(response({ embeddings: 'nope' }), 1)).toBeNull();
    expect(parseEmbeddingResponse(response({ embeddings: [null] }), 1)).toBeNull();
  });

  // Anything but an explicit `true` means "do not assume unit length".
  it('treats a missing normalized flag as false', () => {
    expect(parseEmbeddingResponse(response({ normalized: undefined }), 1)?.normalized).toBe(
      false,
    );
    expect(parseEmbeddingResponse(response({ normalized: 'yes' }), 1)?.normalized).toBe(
      false,
    );
  });

  it('defaults an unusable processing time to zero rather than failing', () => {
    expect(parseEmbeddingResponse(response({ processing_ms: 'fast' }), 1)?.processingMs).toBe(
      0,
    );
  });
});
