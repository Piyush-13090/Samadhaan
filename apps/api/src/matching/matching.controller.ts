import {
  Controller,
  DefaultValuePipe,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { API_VERSION, type ProblemMatches } from '@samadhaan/shared';
import { Public } from '../auth/decorators/public.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { UserRateLimit } from '../auth/guards/user-rate-limit.guard.js';
import { AppException } from '../common/app.exception.js';
import { MatchesService } from './matches.service.js';

/**
 * Organisations that may be able to help with a problem.
 *
 * Reading is public. Nothing here lets a client write a score: matches are
 * produced only by the background matching job. Recomputing is an operator
 * action for platform administrators.
 */
@Controller({ path: 'problems', version: API_VERSION.replace('v', '') })
export class MatchingController {
  constructor(private readonly matches: MatchesService) {}

  @Public()
  @Get(':publicId/matches')
  forProblem(
    @Param('publicId') publicId: string,
    @Query('limit', new DefaultValuePipe(5), ParseIntPipe) limit: number,
  ): Promise<ProblemMatches> {
    if (limit < 1 || limit > 10) throw AppException.badRequest('limit must be 1–10');
    return this.matches.forProblem(publicId, limit);
  }

  @Post(':publicId/matches/recompute')
  @HttpCode(HttpStatus.ACCEPTED)
  @Roles('ADMIN')
  @UserRateLimit({ bucket: 'match-recompute', max: 30, windowSeconds: 60 })
  async recompute(@Param('publicId') publicId: string): Promise<{ queued: true }> {
    await this.matches.recompute(publicId);
    return { queued: true };
  }
}
