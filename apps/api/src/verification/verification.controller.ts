import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import {
  API_VERSION,
  type EvidenceView,
  type GovernmentVerificationView,
  type ProjectVerificationView,
} from '@samadhaan/shared';
import type { RequestUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { UserRateLimit } from '../auth/guards/user-rate-limit.guard.js';
import { AppException } from '../common/app.exception.js';
import type { GovernmentScope } from '../government/government-access.service.js';
import { CurrentGovernment, GovernmentGuard } from '../government/government.guard.js';
import { ProjectsService } from '../resolution/projects.service.js';
import { EvidenceService } from './evidence.service.js';
import { GovernmentVerificationService } from './government-verification.service.js';
import {
  ApproveResolutionDto,
  CreateEvidenceDto,
  DecisionReasonDto,
  EvidenceFileDto,
  RequestVerificationDto,
} from './verification.dto.js';

type UploadedEvidence =
  { buffer: Buffer; originalname?: string; size: number } | undefined;

/**
 * Resolution evidence (Prompt 22). Access is the project's: participants of
 * its resolution room, anyone else 404. Writes are the assigned organisation's.
 */
@Controller({ version: API_VERSION.replace('v', '') })
export class EvidenceController {
  constructor(
    private readonly evidence: EvidenceService,
    private readonly projects: ProjectsService,
  ) {}

  @Get('resolution-projects/:id/evidence')
  async list(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<EvidenceView[]> {
    return this.evidence.list(await this.projects.resolve(id, user), user);
  }

  @Post('resolution-projects/:id/evidence')
  @HttpCode(HttpStatus.CREATED)
  @UserRateLimit({ bucket: 'evidence-write', max: 30, windowSeconds: 600 })
  async create(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateEvidenceDto,
  ): Promise<EvidenceView> {
    return this.evidence.create(
      await this.projects.resolve(id, user),
      {
        evidenceType: dto.evidenceType,
        title: dto.title,
        description: dto.description ?? null,
        replacesEvidenceId: dto.replacesEvidenceId,
      },
      user,
    );
  }

  @Get('resolution-projects/:id/verification')
  async verification(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ProjectVerificationView> {
    return this.evidence.projectView(await this.projects.resolve(id, user), user);
  }

  @Post('resolution-projects/:id/verification/request')
  @HttpCode(HttpStatus.OK)
  @UserRateLimit({ bucket: 'verification-request', max: 5, windowSeconds: 600 })
  async requestVerification(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RequestVerificationDto,
  ): Promise<ProjectVerificationView> {
    return this.evidence.requestVerification(
      await this.projects.resolve(id, user),
      dto.note ?? null,
      user,
    );
  }

  @Get('evidence/:id')
  view(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<EvidenceView> {
    return this.evidence.view(id, user);
  }

  @Post('evidence/:id/files')
  @HttpCode(HttpStatus.CREATED)
  @UserRateLimit({ bucket: 'evidence-upload', max: 40, windowSeconds: 600 })
  @UseInterceptors(FileInterceptor('file'))
  upload(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: UploadedEvidence,
    @Body() dto: EvidenceFileDto,
  ): Promise<EvidenceView> {
    if (!file) throw AppException.badRequest('Choose a file to upload.');
    return this.evidence.uploadFile(id, file, dto.role, user);
  }

  @Delete('evidence/:id/files/:fileId')
  removeFile(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
  ): Promise<EvidenceView> {
    return this.evidence.removeFile(id, fileId, user);
  }

  @Post('evidence/:id/submit')
  @HttpCode(HttpStatus.OK)
  submit(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<EvidenceView> {
    return this.evidence.submit(id, user);
  }

  @Post('evidence/:id/withdraw')
  @HttpCode(HttpStatus.OK)
  withdraw(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<EvidenceView> {
    return this.evidence.withdraw(id, user);
  }

  /** Runs the AI review again. Never changes the evidence's lifecycle status. */
  @Post('evidence/:id/analyze')
  @HttpCode(HttpStatus.ACCEPTED)
  @UserRateLimit({ bucket: 'evidence-analyze', max: 5, windowSeconds: 600 })
  analyze(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<EvidenceView> {
    return this.evidence.analyze(id, user);
  }

  /** A file, after the access check. Never public media; never a storage key. */
  @Get('evidence/:id/files/:fileId')
  async file(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Res() response: Response,
  ): Promise<void> {
    const { buffer, mimeType, fileName } = await this.evidence.file(id, fileId, user);
    const inline = mimeType.startsWith('image/') || mimeType.startsWith('video/');
    response
      .status(200)
      .set({
        'Content-Type': mimeType,
        'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      })
      .send(buffer);
  }
}

/**
 * The government's verification decisions (Prompt 22): the portal's
 * authorisation, plus — in the service — only the office that allocated the
 * project may decide.
 */
@Controller({ path: 'government', version: API_VERSION.replace('v', '') })
@Roles('GOVERNMENT')
@UseGuards(GovernmentGuard)
export class GovernmentVerificationController {
  constructor(private readonly verification: GovernmentVerificationService) {}

  @Get(':slug/problems/:publicId/verification')
  view(
    @CurrentGovernment() scope: GovernmentScope,
    @CurrentUser() user: RequestUser,
    @Param('publicId') publicId: string,
  ): Promise<GovernmentVerificationView> {
    return this.verification.view(scope, publicId, user);
  }

  @Post(':slug/problems/:publicId/verification/approve')
  @HttpCode(HttpStatus.OK)
  @UserRateLimit({ bucket: 'verification-decide', max: 20, windowSeconds: 600 })
  approve(
    @CurrentGovernment() scope: GovernmentScope,
    @CurrentUser() user: RequestUser,
    @Param('publicId') publicId: string,
    @Body() dto: ApproveResolutionDto,
  ): Promise<GovernmentVerificationView> {
    return this.verification.decide(
      scope,
      publicId,
      'APPROVED',
      { reason: null, note: dto.note ?? null },
      user,
    );
  }

  @Post(':slug/problems/:publicId/verification/reject')
  @HttpCode(HttpStatus.OK)
  @UserRateLimit({ bucket: 'verification-decide', max: 20, windowSeconds: 600 })
  reject(
    @CurrentGovernment() scope: GovernmentScope,
    @CurrentUser() user: RequestUser,
    @Param('publicId') publicId: string,
    @Body() dto: DecisionReasonDto,
  ): Promise<GovernmentVerificationView> {
    return this.verification.decide(
      scope,
      publicId,
      'REJECTED',
      { reason: dto.reason, note: null },
      user,
    );
  }

  @Post(':slug/problems/:publicId/verification/request-evidence')
  @HttpCode(HttpStatus.OK)
  @UserRateLimit({ bucket: 'verification-decide', max: 20, windowSeconds: 600 })
  requestEvidence(
    @CurrentGovernment() scope: GovernmentScope,
    @CurrentUser() user: RequestUser,
    @Param('publicId') publicId: string,
    @Body() dto: DecisionReasonDto,
  ): Promise<GovernmentVerificationView> {
    return this.verification.decide(
      scope,
      publicId,
      'MORE_EVIDENCE_REQUESTED',
      { reason: dto.reason, note: null },
      user,
    );
  }
}
