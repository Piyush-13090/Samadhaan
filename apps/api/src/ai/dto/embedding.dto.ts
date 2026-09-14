import { EMBEDDING_DIMENSIONS } from '@samadhaan/shared';

/**
 * The AI service's embedding response, in its own wire shape.
 *
 * snake_case because that is what the Python service emits. Translation to
 * camelCase happens once, in `parseEmbeddingResponse`.
 */
export interface AiEmbeddingResponse {
  embeddings: Array<{ index: number; embedding: number[] }>;
  provider: string;
  model_name: string;
  model_version: string;
  dimensions: number;
  normalized: boolean;
  processing_ms: number;
}

/** The validated, camelCase form the rest of the API works with. */
export interface AiEmbeddings {
  /** One vector per input text, in request order. */
  vectors: number[][];
  provider: string;
  modelName: string;
  modelVersion: string;
  dimensions: number;
  normalized: boolean;
  processingMs: number;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Validates an embedding response before anything is written.
 *
 * The AI service already checks its own output, and this checks it again — for
 * the same reason the analysis DTO does: this process performs the database
 * write, and pgvector will reject a mis-shaped vector with a message about a
 * column rather than about a model.
 *
 * Returns `null` rather than throwing. An unusable response is an expected
 * operational state the caller degrades around.
 */
export function parseEmbeddingResponse(
  payload: unknown,
  expectedCount: number,
): AiEmbeddings | null {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return null;
  }

  const body = payload as Partial<AiEmbeddingResponse>;

  if (
    !isNonEmptyString(body.provider) ||
    !isNonEmptyString(body.model_name) ||
    !isNonEmptyString(body.model_version)
  ) {
    return null;
  }

  // The width must match the column exactly. A vector of any other size is not
  // "slightly wrong" — it is incomparable with the entire existing corpus.
  if (body.dimensions !== EMBEDDING_DIMENSIONS) return null;

  if (!Array.isArray(body.embeddings)) return null;

  // A count mismatch would misalign every vector with its source text: the
  // failure that still looks well-formed all the way to the database.
  if (body.embeddings.length !== expectedCount) return null;

  const vectors: number[][] = [];

  // Sorted by the service-reported index rather than trusting array order, so
  // a reordering upstream cannot silently attach the wrong vector to a problem.
  const ordered = [...body.embeddings].sort((a, b) => (a?.index ?? 0) - (b?.index ?? 0));

  for (const [position, entry] of ordered.entries()) {
    if (typeof entry !== 'object' || entry === null) return null;
    if (entry.index !== position) return null;
    if (!Array.isArray(entry.embedding)) return null;
    if (entry.embedding.length !== EMBEDDING_DIMENSIONS) return null;
    if (!entry.embedding.every(isFiniteNumber)) return null;

    vectors.push(entry.embedding);
  }

  return {
    vectors,
    provider: body.provider,
    modelName: body.model_name,
    modelVersion: body.model_version,
    dimensions: body.dimensions,
    normalized: body.normalized === true,
    processingMs: isFiniteNumber(body.processing_ms) ? Math.round(body.processing_ms) : 0,
  };
}
