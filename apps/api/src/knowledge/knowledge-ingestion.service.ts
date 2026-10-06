import { createHash } from 'node:crypto';
import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { EMBEDDING_DIMENSIONS } from '@samadhaan/shared';
import { AiService } from '../ai/ai.service.js';
import { AppConfig } from '../config/app.config.js';
import { PrismaService } from '../database/prisma.service.js';
import { toVectorLiteral } from '../problems/services/problem-embedding.store.js';
import { StorageService } from '../storage/storage.types.js';

/** Caller-safe messages: never provider detail, paths or stack traces. */
const SAFE_MESSAGES: Record<string, string> = {
  EMPTY_DOCUMENT: 'The document has no readable text.',
  MALFORMED_DOCUMENT: 'The document could not be read. Check that it is a valid file.',
  UNSUPPORTED_DOCUMENT:
    'This file type is not supported. Use PDF, plain text, Markdown or HTML.',
  DOCUMENT_TOO_LARGE: 'The document is too large to index.',
  NO_CONTENT: 'There is nothing to index: add text or upload a file.',
  EMBEDDING_UNAVAILABLE: 'The embedding service is unavailable. Try again later.',
  PROCESSING_UNAVAILABLE: 'Document processing is unavailable. Try again later.',
};

const EMBED_BATCH = 64;

/**
 * Knowledge ingestion (Prompt 20):
 *
 *   PENDING ─▶ PROCESSING ─▶ extract · clean · chunk (AI service)
 *                          ─▶ embed new chunks (AI service; unchanged chunks reuse
 *                             their vectors by content hash and model)
 *                          ─▶ replace documents + chunks in one transaction
 *                          ─▶ COMPLETED (counts, model, versions)   or   FAILED (safe reason)
 *
 * Runs in the background — an in-process queue, one source at a time — so an
 * upload returns at once and a large PDF never holds a request open. On boot,
 * sources left PENDING or PROCESSING (a restart mid-ingest) are queued again.
 */
@Injectable()
export class KnowledgeIngestionService implements OnApplicationBootstrap {
  private readonly logger = new Logger(KnowledgeIngestionService.name);
  private readonly queue: string[] = [];
  private readonly queued = new Set<string>();
  private running: Promise<void> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly storage: StorageService,
    private readonly config: AppConfig,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.rag.sweepOnStartup) return;
    const pending = await this.prisma.knowledgeSource
      .findMany({
        where: { status: { in: ['PENDING', 'PROCESSING'] } },
        select: { id: true },
        take: 200,
      })
      .catch(() => []);
    for (const { id } of pending) this.enqueue(id);
  }

  /** Queue a source. Idempotent while it waits. */
  enqueue(sourceId: string): void {
    if (this.queued.has(sourceId)) return;
    this.queued.add(sourceId);
    this.queue.push(sourceId);
    this.running ??= this.drainQueue().finally(() => {
      this.running = null;
    });
  }

  /** Resolves when the queue is empty. For tests and shutdown. */
  async idle(): Promise<void> {
    while (this.running) await this.running;
  }

  private async drainQueue(): Promise<void> {
    while (this.queue.length > 0) {
      const id = this.queue.shift()!;
      this.queued.delete(id);
      await this.ingest(id).catch((error: unknown) =>
        this.logger.error(
          `Ingestion crashed for ${id}: ${error instanceof Error ? error.message : 'unknown'}`,
        ),
      );
    }
  }

  /** One source, start to finish. Never throws; the outcome is the status. */
  async ingest(sourceId: string): Promise<void> {
    const started = Date.now();
    const claimed = await this.prisma.knowledgeSource.updateMany({
      where: {
        id: sourceId,
        status: { in: ['PENDING', 'PROCESSING', 'FAILED', 'COMPLETED'] },
      },
      data: {
        status: 'PROCESSING',
        attempts: { increment: 1 },
        failureCode: null,
        failureMessage: null,
      },
    });
    if (claimed.count === 0) return;
    const source = await this.prisma.knowledgeSource.findUnique({
      where: { id: sourceId },
    });
    if (!source) return;

    try {
      // 1. The content: pasted text or the stored file. External URLs are
      //    references only — never fetched (no server-side requests to
      //    arbitrary addresses).
      let input: { text?: string; fileBase64?: string; mimeType?: string | null };
      if (source.storageKey) {
        const bytes = await this.storage.get(source.storageKey);
        if (!bytes) return this.fail(sourceId, 'NO_CONTENT');
        input = { fileBase64: bytes.toString('base64'), mimeType: source.mimeType };
      } else if (source.inlineText?.trim()) {
        input = { text: source.inlineText, mimeType: 'text/markdown' };
      } else {
        return this.fail(sourceId, 'NO_CONTENT');
      }

      // 2. Extract, clean, chunk.
      const chunked = await this.ai.chunkDocument(input, this.config.rag.chunk);
      if (!chunked.ok) {
        const code = SAFE_MESSAGES[chunked.failure.code]
          ? chunked.failure.code
          : 'PROCESSING_UNAVAILABLE';
        return this.fail(sourceId, code);
      }
      const { chunks } = chunked.result;
      if (chunks.length === 0) return this.fail(sourceId, 'EMPTY_DOCUMENT');

      // 3. Embeddings: reuse vectors for unchanged chunks of this source.
      const existing = await this.prisma.$queryRaw<
        Array<{
          contentHash: string;
          embeddingModel: string;
          embeddingVersion: string;
          embedding: string;
        }>
      >`
        SELECT DISTINCT ON ("contentHash") "contentHash", "embeddingModel", "embeddingVersion", "embedding"::text AS "embedding"
        FROM knowledge_chunks
        WHERE "sourceId" = ${sourceId}::uuid AND "embedding" IS NOT NULL
          AND "contentHash" = ANY(${chunks.map((c) => c.contentHash)})
      `;
      const reuse = new Map(existing.map((row) => [row.contentHash, row]));
      const vectors = new Map<
        string,
        { literal: string; model: string; version: string }
      >();
      let model: string | null = null;
      let version: string | null = null;

      const missing = chunks.filter((c) => !reuse.has(c.contentHash));
      for (let i = 0; i < missing.length; i += EMBED_BATCH) {
        const batch = missing.slice(i, i + EMBED_BATCH);
        const embedded = await this.ai.embedText(batch.map((c) => c.content));
        if (!embedded.ok) return this.fail(sourceId, 'EMBEDDING_UNAVAILABLE');
        const { vectors: out, modelName, modelVersion, dimensions } = embedded.embeddings;
        if (dimensions !== EMBEDDING_DIMENSIONS || out.length !== batch.length) {
          return this.fail(sourceId, 'EMBEDDING_UNAVAILABLE');
        }
        model = modelName;
        version = modelVersion;
        batch.forEach((c, index) =>
          vectors.set(c.contentHash, {
            literal: toVectorLiteral(out[index]!),
            model: modelName,
            version: modelVersion,
          }),
        );
      }
      // Reused vectors only count if they come from the current model.
      for (const [hash, row] of reuse) {
        if (model && row.embeddingModel !== model) {
          const embedded = await this.ai.embedText([
            chunks.find((c) => c.contentHash === hash)!.content,
          ]);
          if (!embedded.ok) return this.fail(sourceId, 'EMBEDDING_UNAVAILABLE');
          vectors.set(hash, {
            literal: toVectorLiteral(embedded.embeddings.vectors[0]!),
            model: embedded.embeddings.modelName,
            version: embedded.embeddings.modelVersion,
          });
        } else {
          vectors.set(hash, {
            literal: row.embedding,
            model: row.embeddingModel,
            version: row.embeddingVersion,
          });
          model ??= row.embeddingModel;
          version ??= row.embeddingVersion;
        }
      }

      // 4. Replace the source's documents and chunks atomically.
      const fullText = chunks.map((c) => c.content).join('\n\n');
      await this.prisma.$transaction(
        async (tx) => {
          await tx.knowledgeDocument.deleteMany({
            where: { knowledgeSourceId: sourceId },
          });
          const document = await tx.knowledgeDocument.create({
            data: {
              knowledgeSourceId: sourceId,
              title: source.fileName ?? source.title,
              content: fullText,
              contentHash: createHash('sha256').update(fullText).digest('hex'),
              pageCount: chunked.result.pageCount,
              metadata: {
                detectedType: chunked.result.detectedType,
                characters: chunked.result.characterCount,
              },
            },
          });
          for (const c of chunks) {
            const v = vectors.get(c.contentHash)!;
            await tx.$executeRaw`
              INSERT INTO knowledge_chunks
                ("id", "documentId", "sourceId", "chunkIndex", "content", "tokenCount", "sectionTitle",
                 "pageNumber", "contentHash", "embedding", "embeddingModel", "embeddingVersion", "dimensions",
                 "createdAt", "updatedAt")
              VALUES
                (gen_random_uuid(), ${document.id}::uuid, ${sourceId}::uuid, ${c.index}, ${c.content},
                 ${c.tokenCount}, ${c.sectionTitle}, ${c.pageNumber}, ${c.contentHash}, ${v.literal}::vector,
                 ${v.model}, ${v.version}, ${EMBEDDING_DIMENSIONS}, now(), now())
            `;
          }
          await tx.knowledgeSource.update({
            where: { id: sourceId },
            data: {
              status: 'COMPLETED',
              chunkCount: chunks.length,
              embeddingModel: model,
              embeddingVersion: version,
              chunkerVersion: chunked.result.chunkerVersion,
              ingestedAt: new Date(),
              failureCode: null,
              failureMessage: null,
            },
          });
        },
        { timeout: 60_000 },
      );
      this.logger.log(
        `Ingested source ${sourceId}: ${chunks.length} chunks (${missing.length} embedded, ` +
          `${chunks.length - missing.length} reused) in ${Date.now() - started} ms`,
      );
    } catch (error) {
      this.logger.error(
        `Ingestion failed for ${sourceId}: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      await this.fail(sourceId, 'PROCESSING_UNAVAILABLE');
    }
  }

  private async fail(sourceId: string, code: string): Promise<void> {
    await this.prisma.knowledgeSource.updateMany({
      where: { id: sourceId },
      data: {
        status: 'FAILED',
        failureCode: code,
        failureMessage: SAFE_MESSAGES[code] ?? SAFE_MESSAGES.PROCESSING_UNAVAILABLE,
      },
    });
    this.logger.warn(`Ingestion of ${sourceId} failed: ${code}`);
  }
}
