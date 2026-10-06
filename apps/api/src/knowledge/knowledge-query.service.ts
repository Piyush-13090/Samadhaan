import { Injectable, Logger } from '@nestjs/common';
import { HttpStatus } from '@nestjs/common';
import {
  ERROR_CODES,
  type KnowledgeAnswerView,
  type KnowledgeCitation,
  type KnowledgeContext,
} from '@samadhaan/shared';
import { AiService } from '../ai/ai.service.js';
import type { RequestUser } from '../auth/auth.types.js';
import { AppException } from '../common/app.exception.js';
import { AppConfig } from '../config/app.config.js';
import { PrismaService } from '../database/prisma.service.js';
import { ProjectsService } from '../resolution/projects.service.js';
import { KnowledgeAccessService } from './knowledge-access.service.js';
import {
  KnowledgeContextBuilder,
  type ApplicationContext,
} from './knowledge-context.builder.js';
import {
  KnowledgeRetrievalService,
  RetrievalUnavailableError,
  type RetrievalResult,
} from './knowledge-retrieval.service.js';

const NOT_ENOUGH =
  'The knowledge base does not contain enough information to answer this.';

/**
 * `POST /knowledge/query` (Prompt 20):
 *
 *   authenticate ─▶ validate the context (problem visible? project participant?)
 *   ─▶ build the access scope ─▶ retrieve (authorised chunks only)
 *   ─▶ answer from those chunks (AI service) ─▶ re-check citations
 *   ─▶ record model, embedding, retrieval and prompt versions ─▶ respond
 *
 * The model only ever sees chunks that passed the SQL access predicate.
 * With nothing retrieved, it is not called at all.
 */
@Injectable()
export class KnowledgeQueryService {
  private readonly logger = new Logger(KnowledgeQueryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly access: KnowledgeAccessService,
    private readonly retrieval: KnowledgeRetrievalService,
    private readonly builder: KnowledgeContextBuilder,
    private readonly projects: ProjectsService,
    private readonly config: AppConfig,
  ) {}

  async query(
    user: RequestUser,
    input: {
      query: string;
      context: KnowledgeContext;
      problemId?: string;
      projectId?: string;
      topK?: number;
      mode: 'answer' | 'retrieve';
    },
  ): Promise<KnowledgeAnswerView> {
    if (!this.config.rag.enabled) {
      throw new AppException(
        ERROR_CODES.UPSTREAM_UNAVAILABLE,
        'The knowledge assistant is turned off.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    // 1. Context and authority — before anything is retrieved.
    let app: ApplicationContext | null = null;
    let projectId: string | null = null;
    if (input.context === 'PROBLEM') {
      if (!input.problemId)
        throw AppException.badRequest('Choose the problem to ask about.');
      app = await this.builder.forProblem(input.problemId, user);
    } else if (input.context === 'PROJECT') {
      if (!input.projectId)
        throw AppException.badRequest('Choose the project to ask about.');
      const project = await this.projects.resolve(input.projectId, user); // 404 unless a participant
      projectId = project.project.id;
      app = await this.builder.forProject(project);
    }
    const scope = await this.access.scope(user);
    if (projectId) scope.projectId = projectId; // proven above

    // 2. Retrieve.
    let retrieved: RetrievalResult;
    try {
      retrieved = await this.retrieval.retrieve({
        semanticQuery: app ? `${input.query}\n\nContext: ${app.hint}` : input.query,
        keywordQuery: input.query,
        scope,
        context: {
          kind: input.context,
          category: app?.category ?? null,
          city: app?.city ?? null,
        },
        topK: input.topK,
      });
    } catch (error) {
      if (error instanceof RetrievalUnavailableError) {
        throw new AppException(
          ERROR_CODES.UPSTREAM_UNAVAILABLE,
          'Knowledge search is unavailable right now. Try again shortly.',
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
      throw error;
    }

    const maxChars = this.config.rag.maxPassageChars;
    const evidence = retrieved.passages.map((p, index) => ({
      ref: `E${index + 1}`,
      title: p.title,
      section: p.sectionTitle,
      content: p.content.slice(0, maxChars),
    }));
    const citationsBase = retrieved.passages.map((p, index) => ({
      ref: `E${index + 1}`,
      sourceId: p.sourceId,
      documentId: p.documentId,
      chunkId: p.chunkId,
      title: p.title,
      sourceType: p.sourceType,
      sectionTitle: p.sectionTitle,
      pageNumber: p.pageNumber,
      relevanceScore: p.score,
      excerpt: p.content.length > 320 ? `${p.content.slice(0, 319)}…` : p.content,
      href: `/knowledge/sources/${p.sourceId}#chunk-${p.chunkId}`,
    }));

    const base = {
      question: input.query,
      context: input.context,
      weakRetrieval: retrieved.weak,
      retrieval: {
        embeddingModel: retrieved.embeddingModel,
        embeddingVersion: retrieved.embeddingVersion,
        retrievalVersion: retrieved.retrievalVersion,
        candidates: retrieved.candidates,
        returned: retrieved.passages.length,
      },
      answeredAt: new Date().toISOString(),
    };

    if (input.mode === 'retrieve') {
      return {
        ...base,
        id: null,
        answer: null,
        insufficientEvidence: evidence.length === 0,
        suggestions: [],
        sources: citationsBase.map((c) => ({ ...c, cited: false })),
        model: null,
      };
    }

    // 3. Generate — only from authorised evidence; nothing to cite, no call.
    const record = {
      userId: user.id,
      contextType: input.context,
      problemId: null as string | null,
      projectId,
      question: input.query.slice(0, 1000),
      embeddingModel: retrieved.embeddingModel,
      embeddingVersion: retrieved.embeddingVersion,
      retrievalVersion: retrieved.retrievalVersion,
      retrievedChunkIds: retrieved.passages.map((p) => p.chunkId),
      scores: retrieved.passages.map((p) => ({
        chunkId: p.chunkId,
        score: p.score,
        ...p.signals,
      })),
      retrievalMs: retrieved.ms,
    };

    if (evidence.length === 0) {
      const saved = await this.prisma.knowledgeAnswer.create({
        data: {
          ...record,
          answer: NOT_ENOUGH,
          insufficientEvidence: true,
          status: 'NO_EVIDENCE',
        },
      });
      return {
        ...base,
        id: saved.id,
        answer: NOT_ENOUGH,
        insufficientEvidence: true,
        suggestions: [],
        sources: [],
        model: null,
      };
    }

    const started = Date.now();
    const outcome = await this.ai.answerKnowledge({
      question: input.query,
      applicationContext: app?.lines ?? [],
      evidence,
    });
    if (!outcome.ok) {
      await this.prisma.knowledgeAnswer.create({
        data: { ...record, status: 'FAILED', generationMs: Date.now() - started },
      });
      this.logger.warn(`RAG generation failed: ${outcome.failure.code}`);
      throw new AppException(
        ERROR_CODES.UPSTREAM_UNAVAILABLE,
        'An answer could not be generated right now. The sources found are still listed.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    const answer = outcome.answer;
    const cited = new Set(answer.evidenceRefs);
    const generationMs = Date.now() - started;
    const saved = await this.prisma.knowledgeAnswer.create({
      data: {
        ...record,
        answer: answer.answer,
        insufficientEvidence: answer.insufficientEvidence,
        status: 'ANSWERED',
        modelName: answer.modelName,
        modelVersion: answer.modelVersion,
        promptVersion: answer.promptVersion,
        generationMs,
      },
    });
    this.logger.log(
      `RAG answer: ${evidence.length} passages, ${cited.size} cited, insufficient=${answer.insufficientEvidence}, ` +
        `retrieval ${retrieved.ms} ms, generation ${generationMs} ms`,
    );
    const sources: KnowledgeCitation[] = citationsBase.map((c) => ({
      ...c,
      cited: cited.has(c.ref),
    }));
    return {
      ...base,
      id: saved.id,
      answer: answer.answer,
      insufficientEvidence: answer.insufficientEvidence,
      suggestions: answer.suggestions,
      sources,
      model: {
        provider: answer.provider,
        name: answer.modelName,
        version: answer.modelVersion,
        promptVersion: answer.promptVersion,
      },
    };
  }
}
