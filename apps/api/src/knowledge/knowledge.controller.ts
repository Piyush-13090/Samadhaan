import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import {
  API_VERSION,
  type KnowledgeAnswerView,
  type KnowledgeAuthoring,
  type KnowledgeChunkView,
  type KnowledgeSourcePage,
  type KnowledgeSourceView,
} from '@samadhaan/shared';
import type { RequestUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { UserRateLimit } from '../auth/guards/user-rate-limit.guard.js';
import { AppException } from '../common/app.exception.js';
import { KnowledgeAccessService } from './knowledge-access.service.js';
import { KnowledgeQueryService } from './knowledge-query.service.js';
import { KnowledgeSourcesService } from './knowledge-sources.service.js';
import {
  CreateKnowledgeSourceDto,
  KnowledgeQueryDto,
  ListKnowledgeSourcesDto,
  UpdateKnowledgeSourceDto,
} from './knowledge.dto.js';

/**
 * `/api/v1/knowledge` — sources, ingestion and RAG queries (Prompt 20). Every
 * read goes through the visibility predicate; a source the caller may not see
 * is 404, exactly like one that does not exist.
 */
@Controller({ path: 'knowledge', version: API_VERSION.replace('v', '') })
export class KnowledgeController {
  constructor(
    private readonly sources: KnowledgeSourcesService,
    private readonly queries: KnowledgeQueryService,
    private readonly access: KnowledgeAccessService,
  ) {}

  @Post('query')
  @HttpCode(HttpStatus.OK)
  @UserRateLimit({ bucket: 'knowledge-query', max: 20, windowSeconds: 60 })
  query(
    @CurrentUser() user: RequestUser,
    @Body() dto: KnowledgeQueryDto,
  ): Promise<KnowledgeAnswerView> {
    return this.queries.query(user, {
      query: dto.query,
      context: dto.contextType ?? 'GENERAL',
      problemId: dto.problemId,
      projectId: dto.projectId,
      topK: dto.topK,
      mode: dto.mode ?? 'answer',
    });
  }

  @Get('authoring')
  authoring(@CurrentUser() user: RequestUser): Promise<KnowledgeAuthoring> {
    return this.access.authoring(user);
  }

  @Get('sources')
  list(
    @CurrentUser() user: RequestUser,
    @Query() query: ListKnowledgeSourcesDto,
  ): Promise<KnowledgeSourcePage> {
    return this.sources.list(user, query);
  }

  @Post('sources')
  @HttpCode(HttpStatus.CREATED)
  @UserRateLimit({ bucket: 'knowledge-write', max: 30, windowSeconds: 600 })
  create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateKnowledgeSourceDto,
  ): Promise<KnowledgeSourceView> {
    return this.sources.create(user, {
      title: dto.title,
      description: dto.description ?? null,
      sourceType: dto.sourceType,
      visibility: dto.visibility,
      organizationId: dto.organizationId ?? null,
      projectId: dto.projectId ?? null,
      externalUrl: dto.externalUrl ?? null,
      content: dto.content ?? null,
      categories: dto.categories ?? [],
      city: dto.city ?? null,
    });
  }

  @Get('sources/:id')
  view(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<KnowledgeSourceView> {
    return this.sources.view(id, user);
  }

  @Get('sources/:id/chunks')
  chunks(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<KnowledgeChunkView[]> {
    return this.sources.chunks(id, user);
  }

  @Patch('sources/:id')
  @UserRateLimit({ bucket: 'knowledge-write', max: 30, windowSeconds: 600 })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateKnowledgeSourceDto,
  ): Promise<KnowledgeSourceView> {
    return this.sources.update(id, user, dto);
  }

  @Delete('sources/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.sources.remove(id, user);
  }

  /** Starts (or retries) ingestion in the background. 202: poll the source. */
  @Post('sources/:id/ingest')
  @HttpCode(HttpStatus.ACCEPTED)
  @UserRateLimit({ bucket: 'knowledge-ingest', max: 10, windowSeconds: 600 })
  ingest(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<KnowledgeSourceView> {
    return this.sources.ingest(id, user);
  }

  @Post('sources/:id/file')
  @HttpCode(HttpStatus.ACCEPTED)
  @UserRateLimit({ bucket: 'knowledge-ingest', max: 10, windowSeconds: 600 })
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile()
    file: { buffer: Buffer; originalname?: string; size: number } | undefined,
  ): Promise<KnowledgeSourceView> {
    if (!file) throw AppException.badRequest('Choose a document to upload.');
    return this.sources.attachFile(id, user, file);
  }

  /** The original file, after the visibility check. Never public media. */
  @Get('sources/:id/file')
  async file(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() response: Response,
  ): Promise<void> {
    const { body, mimeType, fileName } = await this.sources.file(id, user);
    response
      .status(200)
      .set({
        // HTML is served as text, so an uploaded page can never run here.
        'Content-Type': mimeType === 'text/html' ? 'text/plain; charset=utf-8' : mimeType,
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        'Cache-Control': 'private, max-age=300',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      })
      .send(body);
  }
}
