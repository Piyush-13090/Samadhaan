import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import {
  API_VERSION,
  ERROR_CODES,
  type ProblemAnalysisView,
  type ProblemView,
  type UploadedImage,
} from '@samadhaan/shared';
import type { AuthenticatedRequest, RequestUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Public } from '../auth/decorators/public.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AppException } from '../common/app.exception.js';
import { CreateProblemDto } from './dto/create-problem.dto.js';
import { ProblemsService } from './problems.service.js';
import { ProblemAnalysisService } from './services/problem-analysis.service.js';

/** Uploaded file as multer presents it. Typed locally to avoid a global import. */
interface UploadedFileLike {
  buffer: Buffer;
  originalname?: string;
  mimetype?: string;
  size?: number;
}

@Controller({ path: 'problems', version: API_VERSION.replace('v', '') })
export class ProblemsController {
  constructor(
    private readonly problems: ProblemsService,
    private readonly analysis: ProblemAnalysisService,
  ) {}

  /**
   * Accepts one image for a report in progress.
   *
   * Restricted to `CITIZEN` and `ADMIN`. Reporting is a citizen action —
   * organisations and government act *on* problems rather than filing them —
   * and admin is included so the role can exercise the flow. Enforced here by
   * the guard, not by hiding the page.
   *
   * Buffered in memory rather than written to a temp file: the validator must
   * decode the bytes before anything is persisted, and a file on disk before
   * validation is a file that might not be an image.
   */
  @Roles('CITIZEN', 'ADMIN')
  @Post('images')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file'))
  async uploadImage(
    @UploadedFile() file: UploadedFileLike | undefined,
    @CurrentUser() user: RequestUser,
  ): Promise<UploadedImage> {
    if (!file?.buffer) {
      throw new AppException(
        ERROR_CODES.VALIDATION_FAILED,
        'Choose a photo to upload.',
        HttpStatus.BAD_REQUEST,
        [{ field: 'file', message: 'No file was received' }],
      );
    }

    return this.problems.uploadImage(file, user);
  }

  /**
   * Files a civic problem report.
   *
   * The created problem is `SUBMITTED`. It is not verified, and no AI analysis
   * has run — that arrives in the next milestone.
   */
  @Roles('CITIZEN', 'ADMIN')
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body() dto: CreateProblemDto,
    @CurrentUser() user: RequestUser,
  ): Promise<ProblemView> {
    return this.problems.create(dto, user);
  }

  /** The signed-in user's own reports. */
  @Get('mine')
  listOwn(@CurrentUser() user: RequestUser): Promise<ProblemView[]> {
    return this.problems.listOwn(user);
  }

  /**
   * A problem by its public identifier, e.g. `SAM-1023`.
   *
   * Public — civic reports are a public record. The serializer is what keeps
   * the reporter's contact details out of the response.
   */
  @Public()
  @Get(':publicId')
  findOne(
    @Param('publicId') publicId: string,
    @Req() request: Request,
  ): Promise<ProblemView> {
    const viewer = (request as Request & AuthenticatedRequest).user ?? null;

    return this.problems.findByPublicId(publicId, viewer);
  }

  /**
   * The latest AI analysis for a problem.
   *
   * Public, like the problem itself. Returns `null` when none exists rather
   * than 404 — "this problem has no analysis" is a normal state the UI renders,
   * not an error.
   *
   * This is what the frontend polls while an analysis runs. Polling rather than
   * websockets: analysis completes in seconds, a poll is one indexed read, and
   * there is no realtime infrastructure yet. Resolution rooms will need
   * websockets; this does not.
   */
  @Public()
  @Get(':publicId/analysis')
  async getAnalysis(
    @Param('publicId') publicId: string,
    @Req() request: Request,
  ): Promise<ProblemAnalysisView | null> {
    const viewer = (request as Request & AuthenticatedRequest).user ?? null;

    // Resolved through the problem so a DRAFT stays invisible to non-owners —
    // the analysis must not be a way around that check.
    const problem = await this.problems.findByPublicId(publicId, viewer);

    return this.analysis.findLatest(problem.id);
  }

  /**
   * Re-runs analysis for a problem.
   *
   * Restricted to the reporter and platform admins. Each call costs a paid
   * model invocation, so it is neither public nor open to any signed-in user;
   * government re-analysis arrives with the review workflow.
   */
  @Post(':publicId/analyze')
  @HttpCode(HttpStatus.ACCEPTED)
  async reanalyze(
    @Param('publicId') publicId: string,
    @CurrentUser() user: RequestUser,
  ): Promise<ProblemAnalysisView> {
    const problem = await this.problems.findByPublicId(publicId, user);

    if (!problem.isOwnReport && user.role !== 'ADMIN') {
      throw AppException.forbidden('You can only re-analyse your own reports.');
    }

    return this.analysis.retry(problem.id);
  }
}
