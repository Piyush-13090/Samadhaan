import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  KNOWLEDGE_UPLOAD_MAX_BYTES,
  type KnowledgeChunkView,
  type KnowledgeSourcePage,
  type KnowledgeSourceType,
  type KnowledgeSourceView,
  type KnowledgeVisibility,
  type ProblemCategory,
} from '@samadhaan/shared';
import type { RequestUser } from '../auth/auth.types.js';
import { AppException } from '../common/app.exception.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma, type KnowledgeSource } from '../generated/prisma/client.js';
import { StorageService } from '../storage/storage.types.js';
import { KnowledgeAccessService } from './knowledge-access.service.js';
import { KnowledgeIngestionService } from './knowledge-ingestion.service.js';

/** Storage prefix for knowledge files. The public media route refuses it. */
export const KNOWLEDGE_STORAGE_PREFIX = 'knowledge/';

const SOURCE_INCLUDE = {
  organization: { select: { name: true, slug: true, type: true } },
  project: { select: { id: true, roomId: true, name: true } },
  uploadedBy: { select: { fullName: true } },
} satisfies Prisma.KnowledgeSourceInclude;

type SourceRow = Prisma.KnowledgeSourceGetPayload<{ include: typeof SOURCE_INCLUDE }>;

/** The type of an uploaded file, from its bytes. Extension must agree. */
export function detectKnowledgeFile(
  bytes: Buffer,
  fileName: string | undefined,
): 'application/pdf' | 'text/plain' | 'text/markdown' | 'text/html' | null {
  const ext = (fileName ?? '').split('.').pop()?.toLowerCase() ?? '';
  if (bytes.subarray(0, 5).toString('latin1') === '%PDF-')
    return ext === 'pdf' ? 'application/pdf' : null;
  if (bytes.subarray(0, 4096).includes(0)) return null; // binary
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, 65536));
  } catch {
    return null;
  }
  if (ext === 'md' || ext === 'markdown') return 'text/markdown';
  if (ext === 'html' || ext === 'htm') return 'text/html';
  if (ext === 'txt') return 'text/plain';
  return null;
}

/** Knowledge source management (Prompt 20). */
@Injectable()
export class KnowledgeSourcesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: KnowledgeAccessService,
    private readonly ingestion: KnowledgeIngestionService,
    private readonly storage: StorageService,
  ) {}

  async create(
    user: RequestUser,
    input: {
      title: string;
      description: string | null;
      sourceType: KnowledgeSourceType;
      visibility: KnowledgeVisibility;
      organizationId: string | null;
      projectId: string | null;
      externalUrl: string | null;
      content: string | null;
      categories: ProblemCategory[];
      city: string | null;
    },
  ): Promise<KnowledgeSourceView> {
    const owner = await this.access.assertCanCreate(user, input);
    const source = await this.prisma.$transaction(async (tx) => {
      const created = await tx.knowledgeSource.create({
        data: {
          title: input.title,
          description: input.description,
          sourceType: input.sourceType,
          visibility: input.visibility,
          organizationId: owner.organizationId,
          projectId: owner.projectId,
          uploadedById: user.id,
          externalUrl: input.externalUrl,
          inlineText: input.content,
          categories: input.categories,
          city: input.city,
        },
        include: SOURCE_INCLUDE,
      });
      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          action: 'KNOWLEDGE_SOURCE_CREATED',
          entityType: 'KnowledgeSource',
          entityId: created.id,
          metadata: {
            visibility: created.visibility,
            organizationId: created.organizationId,
            projectId: created.projectId,
          },
        },
      });
      return created;
    });
    if (input.content) this.ingestion.enqueue(source.id);
    return this.toView(source, user, true);
  }

  async attachFile(
    sourceId: string,
    user: RequestUser,
    file: { buffer: Buffer; originalname?: string; size: number },
  ): Promise<KnowledgeSourceView> {
    const source = await this.manageable(sourceId, user);
    if (file.buffer.length === 0) throw AppException.badRequest('That file is empty.');
    if (file.buffer.length > KNOWLEDGE_UPLOAD_MAX_BYTES)
      throw AppException.badRequest('Documents must be 10 MB or smaller.');
    const mimeType = detectKnowledgeFile(file.buffer, file.originalname);
    if (!mimeType) {
      throw AppException.badRequest(
        'Upload a PDF, plain text (.txt), Markdown (.md) or HTML (.html) file.',
      );
    }
    const ext = {
      'application/pdf': 'pdf',
      'text/plain': 'txt',
      'text/markdown': 'md',
      'text/html': 'html',
    }[mimeType];
    const key = `${KNOWLEDGE_STORAGE_PREFIX}${source.id}/${randomBytes(16).toString('hex')}.${ext}`;
    await this.storage.put({ key, body: file.buffer, contentType: mimeType });
    const previous = source.storageKey;
    const updated = await this.prisma.knowledgeSource.update({
      where: { id: source.id },
      data: {
        storageKey: key,
        fileName: (file.originalname ?? `document.${ext}`)
          .split(/[\\/]/)
          .pop()!
          .slice(0, 200),
        mimeType,
        sizeBytes: file.buffer.length,
        status: 'PENDING',
      },
      include: SOURCE_INCLUDE,
    });
    if (previous) await this.storage.delete(previous).catch(() => undefined);
    this.ingestion.enqueue(source.id);
    return this.toView(updated, user, true);
  }

  async ingest(sourceId: string, user: RequestUser): Promise<KnowledgeSourceView> {
    await this.manageable(sourceId, user);
    const { count } = await this.prisma.knowledgeSource.updateMany({
      where: { id: sourceId, status: { not: 'PROCESSING' } },
      data: { status: 'PENDING' },
    });
    if (count === 0)
      throw AppException.conflict('This source is being processed already.');
    this.ingestion.enqueue(sourceId);
    return this.view(sourceId, user);
  }

  async list(
    user: RequestUser,
    filters: {
      projectId?: string;
      manageable?: boolean;
      status?: string;
      sourceType?: KnowledgeSourceType;
      q?: string;
      page: number;
      limit: number;
    },
  ): Promise<KnowledgeSourcePage> {
    const scope = await this.access.scope(user, filters.projectId ?? null);
    const where: Prisma.KnowledgeSourceWhereInput = {
      AND: [
        this.access.where(scope),
        // PROJECT sources appear only when listing that project.
        filters.projectId
          ? { projectId: filters.projectId }
          : { visibility: { not: 'PROJECT' } },
        ...(filters.status
          ? [{ status: filters.status as KnowledgeSource['status'] }]
          : []),
        ...(filters.sourceType ? [{ sourceType: filters.sourceType }] : []),
        ...(filters.q
          ? [{ title: { contains: filters.q, mode: 'insensitive' as const } }]
          : []),
      ],
    };
    const [rows, totalCount] = await Promise.all([
      this.prisma.knowledgeSource.findMany({
        where,
        include: SOURCE_INCLUDE,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        skip: (filters.page - 1) * filters.limit,
        take: filters.limit,
      }),
      this.prisma.knowledgeSource.count({ where }),
    ]);
    const views = await Promise.all(rows.map((row) => this.toView(row, user)));
    const items = filters.manageable ? views.filter((v) => v.permissions.canEdit) : views;
    return {
      items,
      page: filters.page,
      limit: filters.limit,
      totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / filters.limit)),
    };
  }

  async view(sourceId: string, user: RequestUser): Promise<KnowledgeSourceView> {
    await this.access.readable(sourceId, user);
    const row = await this.prisma.knowledgeSource.findUniqueOrThrow({
      where: { id: sourceId },
      include: SOURCE_INCLUDE,
    });
    return this.toView(row, user);
  }

  async chunks(sourceId: string, user: RequestUser): Promise<KnowledgeChunkView[]> {
    await this.access.readable(sourceId, user);
    return this.prisma.knowledgeChunk.findMany({
      where: { sourceId },
      orderBy: { chunkIndex: 'asc' },
      take: 500,
      select: {
        id: true,
        chunkIndex: true,
        content: true,
        sectionTitle: true,
        pageNumber: true,
        tokenCount: true,
      },
    });
  }

  async file(
    sourceId: string,
    user: RequestUser,
  ): Promise<{ body: Buffer; mimeType: string; fileName: string }> {
    const source = await this.access.readable(sourceId, user);
    if (!source.storageKey || !source.mimeType) throw AppException.notFound('File');
    const body = await this.storage.get(source.storageKey);
    if (!body) throw AppException.notFound('File');
    return { body, mimeType: source.mimeType, fileName: source.fileName ?? 'document' };
  }

  async update(
    sourceId: string,
    user: RequestUser,
    input: {
      title?: string;
      description?: string | null;
      sourceType?: KnowledgeSourceType;
      categories?: ProblemCategory[];
      city?: string | null;
      externalUrl?: string | null;
      content?: string | null;
    },
  ): Promise<KnowledgeSourceView> {
    await this.manageable(sourceId, user);
    const reindex = input.content !== undefined;
    const row = await this.prisma.knowledgeSource.update({
      where: { id: sourceId },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.sourceType !== undefined ? { sourceType: input.sourceType } : {}),
        ...(input.categories !== undefined ? { categories: input.categories } : {}),
        ...(input.city !== undefined ? { city: input.city } : {}),
        ...(input.externalUrl !== undefined ? { externalUrl: input.externalUrl } : {}),
        ...(reindex ? { inlineText: input.content, status: 'PENDING' } : {}),
      },
      include: SOURCE_INCLUDE,
    });
    if (reindex) this.ingestion.enqueue(sourceId);
    return this.toView(row, user, true);
  }

  async remove(sourceId: string, user: RequestUser): Promise<void> {
    const source = await this.manageable(sourceId, user);
    await this.prisma.$transaction(async (tx) => {
      await tx.knowledgeSource.delete({ where: { id: sourceId } }); // documents and chunks cascade
      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          action: 'KNOWLEDGE_SOURCE_DELETED',
          entityType: 'KnowledgeSource',
          entityId: sourceId,
          metadata: { title: source.title.slice(0, 120), visibility: source.visibility },
        },
      });
    });
    if (source.storageKey)
      await this.storage.delete(source.storageKey).catch(() => undefined);
  }

  /** Readable *and* manageable, or 404/403 respectively. */
  private async manageable(
    sourceId: string,
    user: RequestUser,
  ): Promise<KnowledgeSource> {
    const source = await this.access.readable(sourceId, user);
    if (!(await this.access.canManage(source, user))) {
      throw AppException.forbidden('Only its owners can change this knowledge source.');
    }
    return source;
  }

  private async toView(
    row: SourceRow,
    user: RequestUser,
    canManage?: boolean,
  ): Promise<KnowledgeSourceView> {
    const manage = canManage ?? (await this.access.canManage(row, user));
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      sourceType: row.sourceType,
      visibility: row.visibility,
      organization: row.organization,
      project: row.project,
      uploadedBy: row.uploadedBy ? { name: row.uploadedBy.fullName } : null,
      externalUrl: row.externalUrl,
      file:
        row.storageKey && row.mimeType
          ? {
              name: row.fileName ?? 'document',
              mimeType: row.mimeType,
              sizeBytes: row.sizeBytes ?? 0,
              url: `/api/v1/knowledge/sources/${row.id}/file`,
            }
          : null,
      hasInlineText: Boolean(row.inlineText),
      categories: row.categories,
      city: row.city,
      status: row.status,
      failureMessage: row.failureMessage,
      attempts: row.attempts,
      chunkCount: row.chunkCount,
      embeddingModel: row.embeddingModel,
      embeddingVersion: row.embeddingVersion,
      chunkerVersion: row.chunkerVersion,
      ingestedAt: row.ingestedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      permissions: { canEdit: manage, canDelete: manage, canIngest: manage },
    };
  }
}
