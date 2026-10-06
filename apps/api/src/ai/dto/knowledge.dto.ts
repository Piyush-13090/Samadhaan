/**
 * Knowledge (RAG) between the API and the AI service (Prompt 20). Responses
 * are validated here before anything is stored or shown.
 */

export interface AiChunk {
  index: number;
  content: string;
  tokenCount: number;
  sectionTitle: string | null;
  pageNumber: number | null;
  contentHash: string;
}

export interface AiChunkResult {
  detectedType: string;
  pageCount: number | null;
  characterCount: number;
  chunks: AiChunk[];
  chunkerVersion: string;
}

export interface AiKnowledgeAnswer {
  answer: string;
  insufficientEvidence: boolean;
  evidenceRefs: string[];
  suggestions: string[];
  provider: string;
  modelName: string;
  modelVersion: string;
  promptVersion: string;
  processingMs: number;
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const str = (value: unknown, max: number): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value.slice(0, max) : null;
const int = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;

export function parseChunkResponse(
  body: unknown,
  maxChunks: number,
): AiChunkResult | null {
  if (!isObject(body) || !Array.isArray(body.chunks)) return null;
  const chunkerVersion = str(body.chunker_version, 100);
  const detectedType = str(body.detected_type, 100);
  if (!chunkerVersion || !detectedType || body.chunks.length > maxChunks) return null;
  const chunks: AiChunk[] = [];
  for (const item of body.chunks) {
    if (!isObject(item)) return null;
    const content = str(item.content, 8000);
    const index = int(item.index);
    const tokenCount = int(item.token_count);
    const contentHash =
      typeof item.content_hash === 'string' && /^[0-9a-f]{64}$/.test(item.content_hash)
        ? item.content_hash
        : null;
    if (!content || index === null || tokenCount === null || !contentHash) return null;
    chunks.push({
      index,
      content,
      tokenCount,
      sectionTitle: str(item.section_title, 300),
      pageNumber: int(item.page_number),
      contentHash,
    });
  }
  return {
    detectedType,
    pageCount: int(body.page_count),
    characterCount: int(body.character_count) ?? 0,
    chunks,
    chunkerVersion,
  };
}

/** Citations are re-checked against the evidence the API actually sent. */
export function parseAnswerResponse(
  body: unknown,
  evidenceRefs: ReadonlySet<string>,
): AiKnowledgeAnswer | null {
  if (!isObject(body)) return null;
  const answer = str(body.answer, 4000);
  const provider = str(body.provider, 100);
  const modelName = str(body.model_name, 200);
  const modelVersion = str(body.model_version, 200);
  const promptVersion = str(body.prompt_version, 100);
  if (
    !answer ||
    typeof body.insufficient_evidence !== 'boolean' ||
    !provider ||
    !modelName ||
    !modelVersion ||
    !promptVersion
  ) {
    return null;
  }
  // Remove any citation marker that names evidence that was not sent.
  const cleaned = answer.replace(/\[(E\d{1,3})\]/g, (marker, ref: string) =>
    evidenceRefs.has(ref) ? marker : '',
  );
  const cited = new Set([...cleaned.matchAll(/\[(E\d{1,3})\]/g)].map((m) => m[1]!));
  const listed = Array.isArray(body.evidence_refs)
    ? body.evidence_refs.filter((r): r is string => typeof r === 'string')
    : [];
  const refs = [...new Set([...listed, ...cited])].filter((ref) => evidenceRefs.has(ref));
  return {
    answer: cleaned.trim(),
    insufficientEvidence: body.insufficient_evidence || refs.length === 0,
    evidenceRefs: refs,
    suggestions: Array.isArray(body.suggestions)
      ? body.suggestions
          .map((s) => str(s, 400))
          .filter((s): s is string => s !== null)
          .slice(0, 5)
      : [],
    provider,
    modelName,
    modelVersion,
    promptVersion,
    processingMs: int(body.processing_ms) ?? 0,
  };
}
