import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import {
  API_VERSION,
  ERROR_CODES,
  type DuplicateCheckView,
  type PaginatedData,
  type ProblemAnalysisView,
  type ProblemFeed,
  type ProblemListItem,
  type ProblemView,
  type UploadedImage,
} from '@samadhaan/shared';
import type { AuthenticatedRequest, RequestUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Public } from '../auth/decorators/public.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AppException } from '../common/app.exception.js';
import { CreateProblemDto } from './dto/create-problem.dto.js';
import { DiscoverProblemsQueryDto } from './dto/discover-problems.dto.js';
import { MyProblemsQueryDto } from './dto/my-problems.dto.js';
import { ProblemsService } from './problems.service.js';
import { DuplicateDetectionService } from './services/duplicate-detection.service.js';
import { ProblemDiscoveryService } from './services/problem-discovery.service.js';
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
    private readonly duplicates: DuplicateDetectionService,
    private readonly discovery: ProblemDiscoveryService,
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

  /**
   * The signed-in user's own reports.
   *
   * **The principal is the only source of identity.** There is no `userId`
   * parameter — `MyProblemsQueryDto` cannot express one, and the global
   * `forbidNonWhitelisted` rejects a request that invents one rather than
   * ignoring it. `?userId=someone-else` is a 400, not a leak.
   */
  @Get('my')
  async listMine(
    @Query() query: MyProblemsQueryDto,
    @CurrentUser() user: RequestUser,
  ): Promise<PaginatedData<ProblemListItem>> {
    const { items, nextCursor, totalCount } = await this.discovery.listOwn(user.id, {
      status: query.status,
      category: query.category,
      sort: query.sort,
      limit: query.limit,
      cursor: query.cursor,
    });

    return { items, nextCursor, totalCount };
  }

  /**
   * Problems near a point, or across a city.
   *
   * **Public**, like every other read of a civic report — the point of the
   * platform is that these are a public record. A signed-in caller additionally
   * gets `isOwnReport` on each row, which is the only thing the identity
   * changes; it never widens what is visible.
   *
   * Coordinates are validated and the radius is bounded, so a caller cannot
   * turn an indexed lookup into a full scan. See
   * `DiscoverProblemsQueryDto` for the two search modes.
   */
  @Public()
  @Get('nearby')
  nearby(
    @Query() query: DiscoverProblemsQueryDto,
    @Req() request: Request,
  ): Promise<ProblemFeed> {
    const viewer = (request as Request & AuthenticatedRequest).user ?? null;

    return this.discovery.discover(query, viewer?.id ?? null);
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

  // ========================================================= duplicate checks

  /**
   * Problems that may already describe the same issue.
   *
   * **Public**, like the problem itself, and resolved *through* the problem so
   * a `DRAFT` stays invisible to non-owners — a similarity endpoint must not
   * become a way to enumerate unpublished reports.
   *
   * Returns scores and evidence, never vectors. An embedding reconstructs its
   * source text well enough that publishing the corpus would let anyone probe
   * the similarity space offline.
   */
  @Public()
  @Get(':publicId/similar')
  async getSimilar(
    @Param('publicId') publicId: string,
    @Req() request: Request,
  ): Promise<DuplicateCheckView> {
    const viewer = (request as Request & AuthenticatedRequest).user ?? null;
    const problem = await this.problems.findByPublicId(publicId, viewer);

    return this.readCheck(problem.id);
  }

  /**
   * Records that this report describes the same issue as an existing one.
   *
   * Restricted to the **reporter and platform admins**. Nobody else may decide
   * that someone's report is a duplicate: doing so marks their report
   * `DUPLICATE` and links it to another, which is a judgement about their
   * submission, not a community action.
   *
   * The score itself is never accepted from the client. Only the pair id is,
   * and it is checked against this problem before anything is written.
   */
  @Post(':publicId/duplicates/:candidateId/confirm')
  async confirmDuplicate(
    @Param('publicId') publicId: string,
    @Param('candidateId') candidateId: string,
    @CurrentUser() user: RequestUser,
  ): Promise<DuplicateCheckView> {
    const problem = await this.requireReviewableProblem(publicId, user);
    await this.duplicates.confirm(candidateId, problem.id, user);

    return this.readCheck(problem.id);
  }

  /** Records that this report is a different issue from the suggested one. */
  @Post(':publicId/duplicates/:candidateId/reject')
  async rejectDuplicate(
    @Param('publicId') publicId: string,
    @Param('candidateId') candidateId: string,
    @CurrentUser() user: RequestUser,
  ): Promise<DuplicateCheckView> {
    const problem = await this.requireReviewableProblem(publicId, user);
    await this.duplicates.reject(candidateId, problem.id, user);

    return this.readCheck(problem.id);
  }

  /**
   * Re-runs the duplicate check.
   *
   * Reporter and admins only, like re-analysis: each call re-encodes the report
   * and runs a vector scan, and an open endpoint would be a cheap way to make
   * the service do unbounded work.
   */
  @Post(':publicId/duplicates/analyze')
  @HttpCode(HttpStatus.ACCEPTED)
  async recheckDuplicates(
    @Param('publicId') publicId: string,
    @CurrentUser() user: RequestUser,
  ): Promise<{ status: 'queued' }> {
    const problem = await this.requireReviewableProblem(publicId, user);

    await this.duplicates.retry(problem.id);

    return { status: 'queued' };
  }

  /** Reads the check with thumbnails resolved through the storage driver. */
  private readCheck(problemId: string): Promise<DuplicateCheckView> {
    return this.duplicates.findCheck(problemId, (key) =>
      this.problems.resolveImageUrl(key),
    );
  }

  /**
   * Resolves a problem the caller is allowed to rule on duplicates for.
   *
   * One place, so the three endpoints above cannot drift apart — and so adding
   * a fourth cannot forget the check.
   */
  private async requireReviewableProblem(
    publicId: string,
    user: RequestUser,
  ): Promise<ProblemView> {
    const problem = await this.problems.findByPublicId(publicId, user);

    if (!problem.isOwnReport && user.role !== 'ADMIN') {
      throw AppException.forbidden('You can only review duplicates on your own reports.');
    }

    return problem;
  }
}
