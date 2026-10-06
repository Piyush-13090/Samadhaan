import { Injectable, Logger } from '@nestjs/common';
import type { HealthReport } from '@samadhaan/shared';
import { AiClient, AiRequestError } from './ai.client.js';
import {
  parseAnalysisFailure,
  parseAnalysisResponse,
  type AiAnalysis,
  type AiAnalysisFailure,
} from './dto/analysis.dto.js';
import {
  parseCoordinatorResponse,
  parseExtractResponse,
  type AiCoordinatorResult,
  type AiExtractedUpdate,
  type CoordinatorContext,
} from './dto/coordinator.dto.js';
import { parseEmbeddingResponse, type AiEmbeddings } from './dto/embedding.dto.js';
import {
  parseAnswerResponse,
  parseChunkResponse,
  type AiChunkResult,
  type AiKnowledgeAnswer,
} from './dto/knowledge.dto.js';
import {
  parseMatchResponse,
  toMatchRequest,
  type AiMatchResult,
  type MatchCandidateInput,
  type MatchProblemInput,
} from './dto/matching.dto.js';

/** One image, inlined for the AI service. */
export interface AnalysisImagePayload {
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
  /** Base64-encoded bytes. */
  data: string;
}

/** Everything the AI service needs to analyse one problem. */
export interface AnalyzeProblemInput {
  problemId: string;
  publicId: string;
  title: string;
  description: string;
  categoryHint?: string | null;
  subcategoryHint?: string | null;
  /** Coarse locality only — never coordinates. */
  locality?: string | null;
  images: AnalysisImagePayload[];
  requestId?: string;
}

/** Either a validated analysis or a structured reason it could not be produced. */
export type AnalysisOutcome =
  { ok: true; analysis: AiAnalysis } | { ok: false; failure: AiAnalysisFailure };

/** Either validated matches or a structured reason they could not be produced. */
export type MatchOutcome =
  { ok: true; result: AiMatchResult } | { ok: false; failure: AiAnalysisFailure };

/** Either a grounded coordinator result or why it could not be produced. */
export type CoordinatorOutcome =
  { ok: true; result: AiCoordinatorResult } | { ok: false; failure: AiAnalysisFailure };

export type ChunkOutcome =
  { ok: true; result: AiChunkResult } | { ok: false; failure: AiAnalysisFailure };

export type KnowledgeAnswerOutcome =
  { ok: true; answer: AiKnowledgeAnswer } | { ok: false; failure: AiAnalysisFailure };

export type ExtractOutcome =
  { ok: true; update: AiExtractedUpdate } | { ok: false; failure: AiAnalysisFailure };

/** Either validated vectors or a structured reason they could not be produced. */
export type EmbeddingOutcome =
  { ok: true; embeddings: AiEmbeddings } | { ok: false; failure: AiAnalysisFailure };

/**
 * Application-facing entry point to AI capabilities.
 *
 * Feature modules depend on this service, never on `AiClient` directly, so the
 * transport can change (HTTP today, a queue later) without touching callers.
 *
 * Problem analysis is implemented. Embeddings, duplicate detection and
 * evidence verification are added in later prompts as typed methods here —
 * deliberately not stubbed with fabricated responses.
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(private readonly client: AiClient) {}

  /**
   * Encodes texts into vectors.
   *
   * Never throws, for the same reason `analyzeProblem` does not: an
   * unreachable encoder is an expected operational state, and the caller's
   * decision depends on the structured `retryable` flag rather than on an
   * exception type.
   */
  async embedText(texts: string[], requestId?: string): Promise<EmbeddingOutcome> {
    if (texts.length === 0) {
      return {
        ok: false,
        failure: {
          code: 'INVALID_INPUT',
          message: 'No text was provided to encode.',
          retryable: false,
        },
      };
    }

    const result = await this.client.post<unknown>(
      '/embeddings/text',
      { texts },
      {
        requestId,
        // A local transformer loads on first use — seconds on a cold process,
        // milliseconds afterwards. The default timeout would abort exactly the
        // first request of every deployment.
        timeoutMs: 60_000,
      },
    );

    if (!result.ok) {
      return { ok: false, failure: this.toFailure(result.error) };
    }

    const embeddings = parseEmbeddingResponse(result.value, texts.length);

    if (!embeddings) {
      this.logger.error('AI service returned an unusable embedding response');

      return {
        ok: false,
        failure: {
          code: 'INVALID_MODEL_OUTPUT',
          message: 'The embeddings could not be understood.',
          // Usually a dimension or configuration mismatch, which a retry will
          // not fix — but the encoder is local and free, so one more attempt
          // costs nothing and covers a genuinely transient fault.
          retryable: true,
        },
      };
    }

    return { ok: true, embeddings };
  }

  /**
   * Scores candidate organisations for one problem.
   *
   * Never throws. The AI service computes signals and a ranking; this process
   * retrieved the candidates and persists the result, so nothing the AI
   * service returns can name an organisation that was not offered to it.
   */
  async matchOrganizations(
    problem: MatchProblemInput,
    candidates: MatchCandidateInput[],
    options: { resultLimit: number; minScore: number },
    requestId?: string,
  ): Promise<MatchOutcome> {
    const result = await this.client.post<unknown>(
      '/match/organizations',
      toMatchRequest(problem, candidates, options),
      // Phrase encoding on a cold model takes seconds; afterwards milliseconds.
      { requestId, timeoutMs: 60_000 },
    );

    if (!result.ok) {
      return { ok: false, failure: this.toFailure(result.error) };
    }

    const parsed = parseMatchResponse(
      result.value,
      new Set(candidates.map((candidate) => candidate.organizationId)),
    );

    if (!parsed) {
      this.logger.error(`AI service returned an unusable match for ${problem.publicId}`);
      return {
        ok: false,
        failure: {
          code: 'INVALID_MODEL_OUTPUT',
          message: 'The matching result could not be understood.',
          retryable: true,
        },
      };
    }

    return { ok: true, result: parsed };
  }

  /**
   * Analyses a problem from its images and description.
   *
   * Never throws. Every failure comes back as a structured outcome carrying
   * `retryable`, because the caller's decision — try again, or mark the
   * analysis FAILED — depends entirely on that distinction, and an exception
   * would flatten it into "something went wrong".
   */
  async analyzeProblem(input: AnalyzeProblemInput): Promise<AnalysisOutcome> {
    const result = await this.client.post<unknown>(
      '/analyze/problem',
      {
        problem_id: input.problemId,
        public_id: input.publicId,
        title: input.title,
        description: input.description,
        category_hint: input.categoryHint ?? null,
        subcategory_hint: input.subcategoryHint ?? null,
        locality: input.locality ?? null,
        images: input.images.map((image) => ({
          media_type: image.mediaType,
          data: image.data,
        })),
      },
      {
        requestId: input.requestId,
        // Vision analysis is slower than an ordinary API call; the default
        // timeout would abort a request that was going to succeed.
        timeoutMs: 90_000,
      },
    );

    if (!result.ok) {
      return { ok: false, failure: this.toFailure(result.error) };
    }

    const analysis = parseAnalysisResponse(result.value);

    if (!analysis) {
      // The AI service validates its own output, so reaching here means the
      // contract between the two services has drifted. Retryable, because a
      // second attempt may land on a healthy instance.
      this.logger.error(`AI service returned an unusable analysis for ${input.publicId}`);

      return {
        ok: false,
        failure: {
          code: 'INVALID_MODEL_OUTPUT',
          message: 'The analysis could not be understood.',
          retryable: true,
        },
      };
    }

    return { ok: true, analysis };
  }

  /**
   * AI Project Coordinator (Prompt 19). Sends the structured context the API
   * built; returns a result re-grounded against that context's refs. Never
   * throws.
   */
  async coordinateProject(
    context: CoordinatorContext,
    knownRefs: ReadonlySet<string>,
    targetRefs: ReadonlySet<string>,
    requestId?: string,
  ): Promise<CoordinatorOutcome> {
    const result = await this.client.post<unknown>('/coordinator/analyze', context, {
      requestId,
      timeoutMs: 90_000,
    });
    if (!result.ok) return { ok: false, failure: this.toFailure(result.error) };

    const parsed = parseCoordinatorResponse(
      result.value,
      knownRefs,
      targetRefs,
      context.baseline.health,
    );
    if (!parsed) {
      this.logger.error(
        `AI service returned an unusable coordinator result for ${context.project_id}`,
      );
      return {
        ok: false,
        failure: {
          code: 'INVALID_MODEL_OUTPUT',
          message: 'The coordinator result could not be understood.',
          retryable: true,
        },
      };
    }
    return { ok: true, result: parsed };
  }

  /** Drafts a structured update from free text. A person confirms it. */
  async extractProjectUpdate(
    text: string,
    projectName: string | null,
    requestId?: string,
  ): Promise<ExtractOutcome> {
    const result = await this.client.post<unknown>(
      '/coordinator/extract-update',
      { text, project_name: projectName },
      { requestId, timeoutMs: 60_000 },
    );
    if (!result.ok) return { ok: false, failure: this.toFailure(result.error) };
    const update = parseExtractResponse(result.value);
    if (!update) {
      return {
        ok: false,
        failure: {
          code: 'INVALID_MODEL_OUTPUT',
          message: 'The update draft could not be understood.',
          retryable: true,
        },
      };
    }
    return { ok: true, update };
  }

  /**
   * Knowledge ingestion (Prompt 20): extraction, cleaning and chunking in the
   * AI service. Embedding is a separate call (`embedText`). Never throws.
   */
  async chunkDocument(
    input: { text?: string; fileBase64?: string; mimeType?: string | null },
    settings: { maxTokens: number; overlapTokens: number; maxChunks: number },
    requestId?: string,
  ): Promise<ChunkOutcome> {
    const result = await this.client.post<unknown>(
      '/knowledge/chunk',
      {
        ...(input.text !== undefined
          ? { text: input.text }
          : { file_base64: input.fileBase64 }),
        ...(input.mimeType ? { mime_type: input.mimeType } : {}),
        max_tokens: settings.maxTokens,
        overlap_tokens: settings.overlapTokens,
        max_chunks: settings.maxChunks,
      },
      { requestId, timeoutMs: 120_000 },
    );
    if (!result.ok) return { ok: false, failure: this.toFailure(result.error) };
    const parsed = parseChunkResponse(result.value, settings.maxChunks);
    if (!parsed) {
      return {
        ok: false,
        failure: {
          code: 'INVALID_MODEL_OUTPUT',
          message: 'The chunking result could not be understood.',
          retryable: true,
        },
      };
    }
    return { ok: true, result: parsed };
  }

  /**
   * RAG answer generation over evidence the API already authorised. The
   * response's citations are re-checked against that evidence. Never throws.
   */
  async answerKnowledge(
    input: {
      question: string;
      applicationContext: string[];
      evidence: Array<{
        ref: string;
        title: string;
        section: string | null;
        content: string;
      }>;
    },
    requestId?: string,
  ): Promise<KnowledgeAnswerOutcome> {
    const result = await this.client.post<unknown>(
      '/knowledge/answer',
      {
        question: input.question,
        application_context: input.applicationContext,
        evidence: input.evidence,
      },
      { requestId, timeoutMs: 90_000 },
    );
    if (!result.ok) return { ok: false, failure: this.toFailure(result.error) };
    const parsed = parseAnswerResponse(
      result.value,
      new Set(input.evidence.map((e) => e.ref)),
    );
    if (!parsed) {
      return {
        ok: false,
        failure: {
          code: 'INVALID_MODEL_OUTPUT',
          message: 'The answer could not be understood.',
          retryable: true,
        },
      };
    }
    return { ok: true, answer: parsed };
  }

  /** Maps a transport or HTTP failure onto the structured failure shape. */
  private toFailure(error: Error): AiAnalysisFailure {
    if (error instanceof AiRequestError) {
      const structured = parseAnalysisFailure(error.body);
      if (structured) return structured;

      return {
        code: 'PROVIDER_ERROR',
        message: 'The analysis service returned an error.',
        // 5xx may be transient; 4xx will not fix itself.
        retryable: error.status >= 500,
      };
    }

    // A timeout or an unreachable service — both worth one more attempt.
    return {
      code: 'PROVIDER_ERROR',
      message: 'The analysis service could not be reached.',
      retryable: true,
    };
  }

  /** Probes the AI service. Returns `null` when it is unreachable. */
  async getHealth(requestId?: string): Promise<HealthReport | null> {
    const result = await this.client.get<HealthReport>('/health', {
      requestId,
    });
    return result.ok ? result.value : null;
  }
}
